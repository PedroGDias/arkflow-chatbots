import { NextRequest, NextResponse } from "next/server";
import {
  extractIncomingMessages,
  sendWhatsAppMessage,
  verifyWebhookSubscription,
} from "@/lib/whatsapp";
import { appendMessage, getConversationHistory } from "@/lib/supabase";
import { getAssistantReply } from "@/lib/claude";

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
    await handleIncomingMessage(message.from, message.text);
  }

  // Always 200 quickly so Meta doesn't retry/disable the webhook.
  return NextResponse.json({ ok: true });
}

async function handleIncomingMessage(from: string, text: string): Promise<void> {
  const history = await getConversationHistory(from);
  const reply = await getAssistantReply(history, text);

  await appendMessage(from, { role: "user", content: text });
  await appendMessage(from, { role: "assistant", content: reply });

  await sendWhatsAppMessage(from, reply);
}
