#!/usr/bin/env node
// Copy the bot's stored WhatsApp history into the Arkflow ERP so past chats show
// up on the Conversations page, not just the ones that arrive from now on.
//
// Reads `messages` from the bot's own Supabase project and replays them through
// the same chat_ingest_turns RPC the live webhook uses. Turn keys are derived
// from the message row id, so re-running this changes nothing.
//
// Usage (values come from .env.local):
//   node --env-file=.env.local scripts/backfill-arkflow-chats.mjs [--dry-run]
//
// Env:
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY            the bot's own project
//   ERP_SUPABASE_URL / ERP_SUPABASE_SERVICE_ROLE_KEY    the shared Arkflow ERP
//   ARKFLOW_CHAT_CLIENT_ID     (falls back to ARKFLOW_CLIENT_ID)
//   ARKFLOW_CHAT_AUTOMATION_ID (falls back to ARKFLOW_AUTOMATION_ID)

const PAGE = 1000
const DRY = process.argv.includes('--dry-run')

function need(name, fallback) {
  const v = process.env[name] ?? (fallback ? process.env[fallback] : undefined)
  if (!v) {
    console.error(`Missing ${name}${fallback ? ` (or ${fallback})` : ''}`)
    process.exit(2)
  }
  return v
}

const BOT_URL = need('SUPABASE_URL').replace(/\/$/, '')
const BOT_KEY = need('SUPABASE_SERVICE_ROLE_KEY')
const ERP_URL = need('ERP_SUPABASE_URL').replace(/\/$/, '')
const ERP_KEY = need('ERP_SUPABASE_SERVICE_ROLE_KEY')
const CLIENT_ID = Number(need('ARKFLOW_CHAT_CLIENT_ID', 'ARKFLOW_CLIENT_ID'))
const AUTOMATION_ID = Number(process.env.ARKFLOW_CHAT_AUTOMATION_ID ?? process.env.ARKFLOW_AUTOMATION_ID) || null

const turnKey = (id) => `msg-${String(id).padStart(12, '0')}`

async function api(base, key, path, init = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  if (!res.ok) throw new Error(`${res.status} ${path}: ${(await res.text()).slice(0, 300)}`)
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

async function loadAllMessages() {
  const all = []
  for (let from = 0; ; from += PAGE) {
    const page = await api(BOT_URL, BOT_KEY, `/rest/v1/messages?select=id,phone_number,role,content,created_at&order=id.asc&offset=${from}&limit=${PAGE}`)
    all.push(...page)
    if (page.length < PAGE) break
  }
  return all
}

async function main() {
  const messages = await loadAllMessages()
  console.log(`${messages.length} message(s) in the bot's history`)

  const threads = new Map()
  for (const m of messages) {
    if (!threads.has(m.phone_number)) threads.set(m.phone_number, [])
    threads.get(m.phone_number).push({
      key: turnKey(m.id),
      role: m.role,
      content: m.content,
      at: m.created_at,
    })
  }

  console.log(`${threads.size} thread(s) → client ${CLIENT_ID}${AUTOMATION_ID ? `, automation ${AUTOMATION_ID}` : ''}${DRY ? '  [dry run]' : ''}`)

  let ok = 0
  let failed = 0
  for (const [phone, turns] of threads) {
    if (DRY) {
      console.log(`  ${phone}: ${turns.length} turn(s)`)
      ok++
      continue
    }
    try {
      const id = await api(ERP_URL, ERP_KEY, '/rest/v1/rpc/chat_ingest_turns', {
        method: 'POST',
        body: JSON.stringify({
          p_client_id: CLIENT_ID,
          p_channel: 'whatsapp',
          p_external_id: phone,
          p_turns: turns,
          p_contact_phone: phone,
          p_automation_id: AUTOMATION_ID,
        }),
      })
      console.log(`  ${phone}: ${turns.length} turn(s) → conversation ${id}`)
      ok++
    } catch (e) {
      console.error(`  ! ${phone}: ${e.message}`)
      failed++
    }
  }

  console.log(`\nDone. ${ok} thread(s) written, ${failed} failed.`)
  if (failed) process.exitCode = 1
}

await main()
