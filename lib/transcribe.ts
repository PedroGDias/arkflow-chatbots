import type { DownloadedMedia } from "./whatsapp";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  return "bin";
}

export async function transcribeAudio(media: DownloadedMedia): Promise<string> {
  const form = new FormData();
  const extension = extensionForMimeType(media.mimeType);
  form.append("file", new Blob([media.buffer], { type: media.mimeType }), `audio.${extension}`);
  form.append("model", "whisper-1");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("OPENAI_API_KEY")}` },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Transcription failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as { text: string };
  return data.text;
}
