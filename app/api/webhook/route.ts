import { NextRequest, NextResponse } from "next/server";
import {
  downloadMedia,
  extractIncomingMessages,
  sendWhatsAppMessage,
  verifyWebhookSubscription,
  type IncomingMessage,
} from "@/lib/whatsapp";
import { appendMessage, getConversationHistory } from "@/lib/supabase";
import { getAssistantReply } from "@/lib/claude";
import { transcribeAudio } from "@/lib/transcribe";
import { findOrCreateCustomer, logRun } from "@/lib/erp";
import { logChatTurns, turnKey } from "@/lib/arkflow-chat";

// A reply costs a Claude turn plus tool calls — measured at ~15s on real
// traffic. The platform default is well under that on some plans, and a killed
// function means the user never receives the answer.
export const maxDuration = 60;

// Meta calls this once when you register/verify the webhook URL.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const challenge = verifyWebhookSubscription(
    searchParams.get("hub.mode"),
    searchParams.get("hub.verify_token"),
    searchParams.get("hub.challenge")
  );

  if (challenge === null) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return new NextResponse(challenge, { status: 200 });
}

function isAllowedSender(phoneNumber: string): boolean {
  const allowList = (process.env.ALLOWED_PHONE_NUMBERS ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  return allowList.includes(phoneNumber);
}

// Meta calls this for every inbound message/status update.
export async function POST(request: NextRequest) {
  const payload = await request.json();
  const messages = extractIncomingMessages(payload);

  for (const message of messages) {
    if (!isAllowedSender(message.from)) continue;
    try {
      await handleIncomingMessage(message);
    } catch (err) {
      // Swallow deliberately. A throw here becomes a 5xx, and Meta retries
      // those — re-running Claude and delivering the user a duplicate reply.
      console.error("[webhook] handler failed:", err);
    }
  }

  // Always 200 quickly so Meta doesn't retry/disable the webhook.
  return NextResponse.json({ ok: true });
}

// Interactive taps (buttons/list rows) are turned into a synthetic user message so they
// flow through the same Claude tool loop as typed text — this keeps replies consistent
// and in the user's language instead of hardcoded English branches bypassing Claude.
function describeInteractiveTap(message: IncomingMessage & { kind: "interactive" }): string {
  if (message.replyId === "menu_products" || message.replyId === "menu_services") {
    return `[The user tapped "${message.replyTitle}"]`;
  }
  if (message.replyId.startsWith("cat_")) {
    const slug = message.replyId.slice("cat_".length);
    return `[The user tapped the category "${message.replyTitle}" — call list_items_in_category with category_slug="${slug}"]`;
  }
  return `[The user tapped "${message.replyTitle}"]`;
}

async function handleIncomingMessage(message: IncomingMessage): Promise<void> {
  const from = message.from;
  const startedAt = Date.now();

  let text: string;
  let respondingTo: string; // human-facing inbound content, for the runs telemetry row
  if (message.kind === "audio") {
    text = await transcribeAudio(await downloadMedia(message.mediaId));
    respondingTo = text;
  } else if (message.kind === "interactive") {
    text = describeInteractiveTap(message);
    respondingTo = message.replyTitle;
  } else {
    text = message.text;
    respondingTo = message.text;
  }

  // Run status reflects whether we produced a reply — not whether the outbound
  // WhatsApp send succeeded — so logRun fires exactly once per message.
  let reply: string;
  try {
    const [customerId, history] = await Promise.all([
      findOrCreateCustomer(from),
      getConversationHistory(from),
    ]);
    reply = await getAssistantReply(history, text, { phoneNumber: from, customerId });
  } catch (err) {
    await logRun({
      customer: from,
      respondingTo,
      responseTimeSec: (Date.now() - startedAt) / 1000,
      success: false,
    });
    throw err;
  }

  const elapsedSec = (Date.now() - startedAt) / 1000;
  const assistantContent = reply || "[menu shown to user]";

  // Dispatch the reply FIRST. Reaching a reply already costs ~15s of Claude and
  // tool calls, so anything awaited in front of the send eats into the function's
  // remaining budget — and if the function is killed at the limit, the user gets
  // nothing even though the answer was ready.
  const sending = reply ? sendWhatsAppMessage(from, reply) : Promise.resolve();

  // History + mirror. The row ids are the mirror's de-duplication keys, so these
  // stay ordered relative to each other — just no longer ahead of the send.
  const recording = (async () => {
    const [userMsgId, assistantMsgId] = await Promise.all([
      appendMessage(from, { role: "user", content: text }),
      appendMessage(from, { role: "assistant", content: assistantContent }),
    ]);
    // Distinct timestamps (inbound vs. reply) so the thread reads in order.
    await logChatTurns(from, [
      { key: turnKey(userMsgId), role: "user", content: text, at: new Date(startedAt).toISOString() },
      { key: turnKey(assistantMsgId), role: "assistant", content: assistantContent, at: new Date().toISOString() },
    ]);
  })().catch((err) => console.error("[webhook] failed to record history:", err));

  // Bookkeeping must never fail the request: Meta retries a 5xx, which would
  // re-run Claude and send the user a second reply.
  const telemetry = logRun({
    customer: from,
    respondingTo,
    responseTimeSec: elapsedSec,
    success: true,
  }).catch((err) => console.error("[webhook] failed to log run:", err));

  await Promise.all([sending, recording, telemetry]);
}
