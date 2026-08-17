// Sends a human-written reply to a WhatsApp contact, on behalf of the Arkflow
// portal.
//
// The portal cannot send this itself: it is a static SPA and must never hold a
// Meta credential. It calls the portal's `whatsapp-reply` edge function, which
// authenticates the operator and checks they may act on that conversation, then
// calls this route with a shared secret. So this endpoint trusts the secret for
// authentication and the edge function for authorization — it deliberately does
// no tenant checks of its own.
//
// The bot is the right place for the send because it already owns the token, the
// message history Claude reads, and the ERP mirror. Duplicating any of that in
// the portal would mean two writers of the same conversation.
//
// Env:
//   REPLY_API_SECRET  shared with the portal's edge function
//   (plus the WhatsApp + Supabase vars the rest of the bot uses)

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { appendMessage } from "@/lib/supabase";
import { ingestChatTurns, turnKey } from "@/lib/arkflow-chat";

// A send plus two writes; nowhere near the Claude path's budget, but the default
// on some plans is tight enough to matter.
export const maxDuration = 30;

/** Hours the bot stands down for a contact after a person replies to them. */
const PAUSE_HOURS = 24;

function secretMatches(provided: string | null): boolean {
  const expected = process.env.REPLY_API_SECRET ?? "";
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would itself leak length.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!process.env.REPLY_API_SECRET) {
    console.error("[reply] REPLY_API_SECRET is not set — refusing to send");
    return NextResponse.json({ error: "not_configured" }, { status: 500 });
  }
  if (!secretMatches(request.headers.get("x-reply-secret"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { phoneNumber?: unknown; text?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const phoneNumber = typeof body.phoneNumber === "string" ? body.phoneNumber.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";

  if (!/^\d{6,20}$/.test(phoneNumber)) {
    return NextResponse.json({ error: "invalid_phone_number" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "empty_text" }, { status: 400 });
  }
  // WhatsApp rejects a text body over 4096 characters outright.
  if (text.length > 4096) {
    return NextResponse.json({ error: "text_too_long" }, { status: 400 });
  }

  // Send before recording. If Meta rejects it — outside the 24h service window,
  // bad number — nothing should be written, or the transcript would show a
  // message the contact never received.
  try {
    await sendWhatsAppMessage(phoneNumber, text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[reply] send failed for ${phoneNumber}: ${detail}`);
    return NextResponse.json({ error: "send_failed", detail }, { status: 502 });
  }

  // Recorded as an assistant turn so Claude's context includes it: without this
  // the bot would answer the contact's next message unaware a person had already
  // replied. Failures here are logged, not surfaced — the contact has the message.
  try {
    const messageId = await appendMessage(phoneNumber, { role: "assistant", content: text });
    await ingestChatTurns(
      phoneNumber,
      [{ key: turnKey(messageId), role: "assistant", content: text, at: new Date().toISOString(), via: "human" }],
      null,
      PAUSE_HOURS,
    );
  } catch (err) {
    console.error(`[reply] sent but failed to record for ${phoneNumber}:`, err);
    return NextResponse.json({ ok: true, recorded: false });
  }

  return NextResponse.json({ ok: true, recorded: true, botPausedHours: PAUSE_HOURS });
}
