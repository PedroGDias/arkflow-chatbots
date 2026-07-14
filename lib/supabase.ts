import { createClient } from "@supabase/supabase-js";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export function getSupabaseClient() {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

const HISTORY_LIMIT = 20;

export async function getConversationHistory(
  phoneNumber: string
): Promise<ConversationMessage[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("messages")
    .select("role, content")
    .eq("phone_number", phoneNumber)
    .order("created_at", { ascending: true })
    .limit(HISTORY_LIMIT);

  if (error) throw error;
  return data ?? [];
}

export async function appendMessage(
  phoneNumber: string,
  message: ConversationMessage
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("messages").insert({
    phone_number: phoneNumber,
    role: message.role,
    content: message.content,
  });

  if (error) throw error;
}
