import { NextRequest, NextResponse } from "next/server";
import {
  downloadMedia,
  extractIncomingMessages,
  sendInteractiveButtons,
  sendListMessage,
  sendWhatsAppMessage,
  verifyWebhookSubscription,
  type IncomingMessage,
} from "@/lib/whatsapp";
import { appendMessage, getConversationHistory } from "@/lib/supabase";
import { getAssistantReply } from "@/lib/claude";
import { transcribeAudio } from "@/lib/transcribe";
import { findOrCreateCustomer, listCategories, listItemsByCategory } from "@/lib/erp";

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

async function handleIncomingMessage(message: IncomingMessage): Promise<void> {
  const from = message.from;

  if (message.kind === "interactive") {
    await handleInteractiveReply(from, message.replyId);
    return;
  }

  const text =
    message.kind === "audio"
      ? await transcribeAudio(await downloadMedia(message.mediaId))
      : message.text;

  const customerId = await findOrCreateCustomer(from);
  const history = await getConversationHistory(from);
  const reply = await getAssistantReply(history, text, { phoneNumber: from, customerId });

  await appendMessage(from, { role: "user", content: text });
  await appendMessage(from, { role: "assistant", content: reply });

  await sendWhatsAppMessage(from, reply);
}

async function handleInteractiveReply(from: string, replyId: string): Promise<void> {
  if (replyId === "menu_products" || replyId === "menu_services") {
    const type = replyId === "menu_products" ? "product" : "service";
    const categories = (await listCategories()).filter((c) => c.type === type);
    await sendListMessage(
      from,
      type === "product" ? "Which kind of product?" : "Which service?",
      "Browse",
      [
        {
          title: type === "product" ? "Products" : "Services",
          rows: categories.map((c) => ({ id: `cat_${c.slug}`, title: c.name })),
        },
      ]
    );
    return;
  }

  if (replyId.startsWith("cat_")) {
    const slug = replyId.slice("cat_".length);
    const items = await listItemsByCategory(slug);
    const summary =
      items.length === 0
        ? "No items found in that category right now."
        : items
            .map((i) => `#${i.id} ${i.name} — ${i.price} ${i.currency}${i.unit ? ` / ${i.unit}` : ""}`)
            .join("\n");

    await sendWhatsAppMessage(
      from,
      `${summary}\n\nJust tell me what you'd like and how many (e.g. "2 of #${items[0]?.id ?? "1"}").`
    );

    // Keep this in history so free-text follow-ups have context on what was shown.
    await appendMessage(from, { role: "assistant", content: summary });
    return;
  }
}
