# WhatsApp Bot Template

A code-based WhatsApp bot: Next.js webhook server on Vercel, WhatsApp Cloud API
for messaging, Claude for conversation, Supabase for chat history.

## Architecture

- `app/api/webhook/route.ts` — receives inbound WhatsApp messages (`POST`) and
  handles Meta's webhook verification handshake (`GET`).
- `lib/whatsapp.ts` — sends messages via the Cloud API, parses inbound payloads.
- `lib/claude.ts` — calls Claude with the conversation history to generate a reply.
- `lib/supabase.ts` — reads/writes conversation history.
- `supabase/schema.sql` — the one table (`messages`) this template needs.

## Setup

### 1. Meta / WhatsApp Cloud API

1. Create an app at [developers.facebook.com](https://developers.facebook.com/apps) and add the **WhatsApp** product.
2. Under **API Setup**, note your **Phone number ID** and generate a **temporary access token** (or a permanent one via a System User for production).
3. Send yourself a test message from the dashboard to confirm the number works.

### 2. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Run [`supabase/schema.sql`](supabase/schema.sql) in the SQL editor.
3. Grab the project URL and `service_role` key from **Project Settings > API**.

### 3. Anthropic

Get an API key from [console.anthropic.com](https://console.anthropic.com).

### 4. Environment variables

Copy `.env.example` to `.env.local` and fill in the values from the steps above,
including a `WHATSAPP_VERIFY_TOKEN` — any random string you choose.

```bash
cp .env.example .env.local
```

### 5. Run locally

```bash
npm install
npm run dev
```

To let Meta reach your local webhook, tunnel it (e.g. `ngrok http 3000`) and use
the tunnel URL in the next step.

### 6. Register the webhook with Meta

In your Meta app's **WhatsApp > Configuration**:

- Callback URL: `https://<your-domain>/api/webhook`
- Verify token: the same value as `WHATSAPP_VERIFY_TOKEN`
- Subscribe to the `messages` field.

### 7. Deploy

Push this project to Vercel and set the same environment variables there
(**Project Settings > Environment Variables**). Update the Meta callback URL
to your production domain once deployed.

## How it works

1. A user messages your WhatsApp number.
2. Meta POSTs the message to `/api/webhook`.
3. The handler loads recent history from Supabase, asks Claude for a reply,
   saves both messages, and sends the reply back via the Cloud API.

## Extending it

- **Structured flows** (menus, forms, handoff to a human): branch on message
  content in `handleIncomingMessage` in `app/api/webhook/route.ts` before
  falling back to Claude.
- **Tool use** (bookings, lookups, CRM actions): give Claude tools via the
  `tools` param in `lib/claude.ts` and execute them server-side.
- **Media messages** (images, audio, documents): extend
  `extractIncomingMessages` in `lib/whatsapp.ts` to handle other `type` values.
