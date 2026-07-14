const GRAPH_API_VERSION = "v21.0";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export async function sendWhatsAppMessage(to: string, text: string): Promise<void> {
  const phoneNumberId = env("WHATSAPP_PHONE_NUMBER_ID");
  const token = env("WHATSAPP_ACCESS_TOKEN");

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WhatsApp send failed (${res.status}): ${body}`);
  }
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

interface WhatsAppWebhookPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          from: string;
          type: string;
          text?: { body: string };
        }>;
      };
    }>;
  }>;
}

export interface IncomingMessage {
  from: string;
  text: string;
}

export function extractIncomingMessages(payload: WhatsAppWebhookPayload): IncomingMessage[] {
  const messages: IncomingMessage[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        if (message.type === "text" && message.text) {
          messages.push({ from: message.from, text: message.text.body });
        }
      }
    }
  }

  return messages;
}
