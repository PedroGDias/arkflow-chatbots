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
import { findOrCreateCustomer } from "@/lib/erp";

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

// Meta calls this for every inbound message/status update.
export async function POST(request: NextRequest) {
  const payload = await request.json();
  const messages = extractIncomingMessages(payload);

  for (const message of messages) {
    await handleIncomingMessage(message);
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

  let text: string;
  if (message.kind === "audio") {
    text = await transcribeAudio(await downloadMedia(message.mediaId));
  } else if (message.kind === "interactive") {
    text = describeInteractiveTap(message);
  } else {
    text = message.text;
  }

  const [customerId, history] = await Promise.all([
    findOrCreateCustomer(from),
    getConversationHistory(from),
  ]);
  const reply = await getAssistantReply(history, text, { phoneNumber: from, customerId });

  const writes = [
    appendMessage(from, { role: "user", content: text }),
    appendMessage(from, { role: "assistant", content: reply || "[menu shown to user]" }),
  ];
  if (reply) writes.push(sendWhatsAppMessage(from, reply));

  await Promise.all(writes);
}
