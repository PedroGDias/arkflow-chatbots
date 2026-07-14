const GRAPH_API_VERSION = "v21.0";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function authHeader(): Record<string, string> {
  return { Authorization: `Bearer ${env("WHATSAPP_ACCESS_TOKEN")}` };
}

async function callGraphApi(path: string, body: Record<string, unknown>): Promise<void> {
  const phoneNumberId = env("WHATSAPP_PHONE_NUMBER_ID");
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/${path}`,
    {
      method: "POST",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const responseBody = await res.text();
    throw new Error(`WhatsApp send failed (${res.status}): ${responseBody}`);
  }
}

export async function sendWhatsAppMessage(to: string, text: string): Promise<void> {
  await callGraphApi("messages", {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  });
}

export interface QuickReplyButton {
  id: string;
  title: string;
}

// Max 3 buttons per WhatsApp's interactive button message limit.
function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength - 1) + "…" : text;
}

export async function sendInteractiveButtons(
  to: string,
  bodyText: string,
  buttons: QuickReplyButton[]
): Promise<void> {
  await callGraphApi("messages", {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: {
        buttons: buttons.map((b) => ({
          type: "reply",
          reply: { id: b.id, title: truncate(b.title, 20) },
        })),
      },
    },
  });
}

export interface ListSection {
  title: string;
  rows: Array<{ id: string; title: string; description?: string }>;
}

// Max 10 total rows across sections per WhatsApp's interactive list message limit.
export async function sendListMessage(
  to: string,
  bodyText: string,
  buttonText: string,
  sections: ListSection[]
): Promise<void> {
  const truncatedSections = sections.map((s) => ({
    title: truncate(s.title, 24),
    rows: s.rows.map((r) => ({
      id: r.id,
      title: truncate(r.title, 24),
      description: r.description ? truncate(r.description, 72) : undefined,
    })),
  }));

  await callGraphApi("messages", {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: bodyText },
      action: { button: truncate(buttonText, 20), sections: truncatedSections },
    },
  });
}

export function verifyWebhookSubscription(
  mode: string | null,
  token: string | null,
  challenge: string | null
): string | null {
  const verifyToken = env("WHATSAPP_VERIFY_TOKEN");
  if (mode === "subscribe" && token === verifyToken) {
    return challenge;
  }
  return null;
}

interface WhatsAppWebhookMessage {
  from: string;
  type: string;
  text?: { body: string };
  audio?: { id: string; mime_type: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
  };
}

interface WhatsAppWebhookPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: WhatsAppWebhookMessage[];
      };
    }>;
  }>;
}

export type IncomingMessage =
  | { from: string; kind: "text"; text: string }
  | { from: string; kind: "audio"; mediaId: string }
  | { from: string; kind: "interactive"; replyId: string; replyTitle: string };

export function extractIncomingMessages(payload: WhatsAppWebhookPayload): IncomingMessage[] {
  const messages: IncomingMessage[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        if (message.type === "text" && message.text) {
          messages.push({ from: message.from, kind: "text", text: message.text.body });
        } else if (message.type === "audio" && message.audio) {
          messages.push({ from: message.from, kind: "audio", mediaId: message.audio.id });
        } else if (message.type === "interactive" && message.interactive) {
          const reply = message.interactive.button_reply ?? message.interactive.list_reply;
          if (reply) {
            messages.push({
              from: message.from,
              kind: "interactive",
              replyId: reply.id,
              replyTitle: reply.title,
            });
          }
        }
      }
    }
  }

  return messages;
}

export interface DownloadedMedia {
  buffer: ArrayBuffer;
  mimeType: string;
}

export async function downloadMedia(mediaId: string): Promise<DownloadedMedia> {
  const metaRes = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`, {
    headers: authHeader(),
  });
  if (!metaRes.ok) {
    throw new Error(`Failed to resolve media URL (${metaRes.status}): ${await metaRes.text()}`);
  }
  const meta = (await metaRes.json()) as { url: string; mime_type: string };

  const fileRes = await fetch(meta.url, { headers: authHeader() });
  if (!fileRes.ok) {
    throw new Error(`Failed to download media (${fileRes.status})`);
  }

  return { buffer: await fileRes.arrayBuffer(), mimeType: meta.mime_type };
}
