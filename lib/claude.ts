import Anthropic from "@anthropic-ai/sdk";
import type { ConversationMessage } from "./supabase";

const SYSTEM_PROMPT = `You are a helpful WhatsApp assistant. Keep replies concise and conversational, suitable for a chat message.`;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export async function getAssistantReply(
  history: ConversationMessage[],
  userMessage: string
): Promise<string> {
  const response = await getClient().messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: userMessage },
    ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  return textBlock?.type === "text" ? textBlock.text : "";
}
