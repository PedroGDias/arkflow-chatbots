// Mirrors every WhatsApp turn into the shared Arkflow ERP so the chat shows up
// on the client's Conversations page.
//
// This is a *mirror*, not the source of truth: the bot's own `messages` table
// still drives Claude's context. If the ERP is unreachable the conversation must
// carry on regardless, so callers use logChatTurns() which never throws.
//
// Tenancy: the chat log has its own client/automation vars because the portal
// surfaces these threads under a different workspace than the one the bot books
// orders into. Both default to the ordering tenant when unset.
//
//   ARKFLOW_CHAT_CLIENT_ID      falls back to ARKFLOW_CLIENT_ID
//   ARKFLOW_CHAT_AUTOMATION_ID  falls back to ARKFLOW_AUTOMATION_ID

import { createClient } from "@supabase/supabase-js";

const CHANNEL = "whatsapp";

let client: ReturnType<typeof createClient> | null = null;

function getErpClient(): any {
  if (!client) {
    const url = process.env.ERP_SUPABASE_URL;
    const key = process.env.ERP_SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("ERP_SUPABASE_URL / ERP_SUPABASE_SERVICE_ROLE_KEY not set");
    client = createClient(url, key);
  }
  return client;
}

function chatClientId(): number {
  const raw = process.env.ARKFLOW_CHAT_CLIENT_ID ?? process.env.ARKFLOW_CLIENT_ID;
  if (!raw) throw new Error("Missing env var: ARKFLOW_CHAT_CLIENT_ID or ARKFLOW_CLIENT_ID");
  return Number(raw);
}

function chatAutomationId(): number | null {
  const raw = process.env.ARKFLOW_CHAT_AUTOMATION_ID ?? process.env.ARKFLOW_AUTOMATION_ID;
  return raw ? Number(raw) : null;
}

/**
 * Stable, sortable key for a stored message. Re-sending a turn whose key is
 * already stored is a no-op — that is what makes the historical backfill safe to
 * re-run alongside the live webhook.
 *
 * Zero-padded because the ERP breaks timestamp ties on the key as text, and
 * "msg-9" sorts after "msg-10" otherwise.
 */
export function turnKey(messageId: number | string): string {
  return `msg-${String(messageId).padStart(12, "0")}`;
}

export interface ChatTurn {
  /** Build with turnKey(). */
  key: string;
  role: "user" | "assistant";
  content: string;
  at: string; // ISO 8601
}

/** Append turns to the contact's thread. Throws — use logChatTurns for the hot path. */
export async function ingestChatTurns(
  phoneNumber: string,
  turns: ChatTurn[],
  contactName?: string | null
): Promise<number | null> {
  if (turns.length === 0) return null;

  const supabase = getErpClient();
  const { data, error } = await supabase.rpc("chat_ingest_turns", {
    p_client_id: chatClientId(),
    p_channel: CHANNEL,
    p_external_id: phoneNumber,
    p_turns: turns,
    p_contact_name: contactName ?? null,
    p_contact_phone: phoneNumber,
    p_automation_id: chatAutomationId(),
  });

  if (error) throw new Error(`chat_ingest_turns: ${error.message}`);
  return data as number | null;
}

/** Fire-and-report version for the message handler: a telemetry failure must
 *  never cost the user their reply. */
export async function logChatTurns(
  phoneNumber: string,
  turns: ChatTurn[],
  contactName?: string | null
): Promise<void> {
  try {
    await ingestChatTurns(phoneNumber, turns, contactName);
  } catch (err) {
    console.error("[arkflow-chat] failed to mirror turns:", err);
  }
}
