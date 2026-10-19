import { createRunpodClient, MODEL, MAX_OUTPUT_TOKENS, MAX_REQUEST_BYTES } from './runpod-client.mjs'

const encoder = new TextEncoder()
const FAILURE_KEY = 'island-v1/last-failure.json'
const FAILURE_CODES=new Set(['CONTEXT_LIMIT','INCOMPLETE_RESPONSE','INVALID_JSON','EMPTY_RESPONSE','PROVIDER_REQUEST_REJECTED','PROVIDER_AUTH','PROVIDER_BILLING','PROVIDER_RATE_LIMIT','PROVIDER_NOT_FOUND','PROVIDER_UNAVAILABLE','PROVIDER_TIMEOUT','PROVIDER_NETWORK','PROVIDER_JOB_FAILED','REQUEST_CANCELLED'])
const BUDGET_KEY = 'island-v1/reservations.json'
// Granite published pricing: $1 / million tokens, checked 2026-10-19:
// https://www.runpod.io/pricing . $50 task allowance => 50 million reserved units.
// Units are UTF-8 bytes + overhead + maximum output, NOT measured tokens or dollars.
// Legacy ledger field `tokens` remains for compatibility. Never refund errors.
// This is a local conservative guard, not an account-wide actual-dollar billing cap.
// Durable across deploys. Do not reset this object to silently renew the budget.
export const RESERVATION_UNIT_LIMIT = 50_000_000
const RATE_LIMIT = 600
const jsonResponse = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })

export function validateDialogue(data) {
  if (!data || typeof data.json !== 'boolean' || !Array.isArray(data.messages) || data.messages.length !== 2) return false
  if(data.schema!==undefined && (!data.json||!data.schema||typeof data.schema!=='object'||Array.isArray(data.schema)))return false
  const [system, user] = data.messages
  if (system?.role !== 'system' || user?.role !== 'user' || typeof system.content !== 'string' || typeof user.content !== 'string') return false
  if (!system.content.trim() || !user.content.trim()) return false
  return encoder.encode(JSON.stringify(data)).length <= MAX_REQUEST_BYTES
}

export async function reserveBudget(bucket, tokens, now = Date.now()) {
  for (let attempt = 0; attempt < 32; attempt++) {
    const old = await bucket.get(BUDGET_KEY)
    const state = old ? await old.json() : { tokens: 0, requests: 0, minute: 0, minuteRequests: 0 }
    if (!Number.isSafeInteger(state.tokens) || state.tokens < 0 || !Number.isSafeInteger(tokens) || tokens < 1) throw new Error('Invalid usage ledger')
    const minute = Math.floor(now / 60000)
    const minuteRequests = state.minute === minute ? state.minuteRequests : 0
    if (state.tokens + tokens > RESERVATION_UNIT_LIMIT || minuteRequests >= RATE_LIMIT) return false
    const next = { tokens: state.tokens + tokens, requests: state.requests + 1, minute, minuteRequests: minuteRequests + 1 }
    const result = await bucket.put(BUDGET_KEY, JSON.stringify(next), {
      onlyIf: old ? { etagMatches: old.etag } : new Headers({ 'If-None-Match': '*' }),
      httpMetadata: { contentType: 'application/json' },
    })
    if (result) return true
  }
  return false
}

export async function dialogueRoute(request, env, fetchImpl = fetch) {
  const path = new URL(request.url).pathname
  if (!env.RUNPOD_INFERENCE_KEY || !env.BUCKET) return jsonResponse({ error: 'Conversations are temporarily unavailable.' }, 503)
  if (path === '/api/island/status') {
    if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405)
    const lastFailure=await env.BUCKET.get(FAILURE_KEY)
    const ledger=await env.BUCKET.get(BUDGET_KEY)
    return jsonResponse({ ready: true, model: MODEL, provider: 'Runpod', lastFailure:lastFailure?await lastFailure.json():null, allowance:{reservedUnits:ledger?(await ledger.json()).tokens:0,limitUnits:RESERVATION_UNIT_LIMIT,unit:'conservative reservation units, not billed tokens',pricingBasisUsdPerMillionTokens:1,actualSpendUsd:null} })
  }
  if (path !== '/api/island/dialogue') return jsonResponse({ error: 'Not found' }, 404)
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  const origin = request.headers.get('Origin')
  if (!origin || origin !== new URL(request.url).origin) return jsonResponse({ error: 'Same-origin requests only' }, 403)
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) return jsonResponse({ error: 'JSON required' }, 415)
  if (Number(request.headers.get('Content-Length') || 0) > MAX_REQUEST_BYTES) return jsonResponse({ error: 'Full personal history exceeds the request limit. Nothing was discarded.', code:'CONTEXT_LIMIT' }, 413)
  let raw
  try {
    const reader = request.body?.getReader()
    if (!reader) return jsonResponse({ error: 'Missing request' }, 400)
    const chunks = []; let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_REQUEST_BYTES) { await reader.cancel(); return jsonResponse({ error: 'Full personal history exceeds the request limit. Nothing was discarded.', code:'CONTEXT_LIMIT' }, 413) }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    raw = JSON.parse(new TextDecoder().decode(bytes))
  } catch { return jsonResponse({ error: 'Invalid JSON' }, 400) }
  if (!validateDialogue(raw)) return jsonResponse({ error: 'Invalid dialogue request.',code:'INVALID_REQUEST' }, 400)
  const { messages, json, schema } = raw
  const canonical = JSON.stringify({ model: MODEL, contextPolicy:'full-history-v1', messages, json, ...(schema?{schema}:{}) })
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(canonical))
  const cacheKey = 'island-v1/dialogue/' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
  try {
    const cached = await env.BUCKET.get(cacheKey)
    if (cached) return jsonResponse({ text: await cached.text(), cached: true })
    // Budget is atomic across isolates/visitors; if storage is unavailable, fail closed.
    const reservation=encoder.encode(JSON.stringify({messages,schema})).length + 1024 + MAX_OUTPUT_TOKENS
    if (!await reserveBudget(env.BUCKET, reservation)) {
      const ledger=await env.BUCKET.get(BUDGET_KEY),used=ledger?(await ledger.json()).tokens:0
      const exhausted=used+reservation>RESERVATION_UNIT_LIMIT
      return jsonResponse({error:exhausted?'Local conversation allowance reached.':'Too many requests right now.',code:exhausted?'BUDGET_LIMIT':'RATE_LIMIT'},429)
    }
    const client = createRunpodClient({ apiKey: env.RUNPOD_INFERENCE_KEY, fetchImpl })
    const text = await client.generate(messages, json, request.signal, schema)
    if (json) JSON.parse(text)
    await env.BUCKET.put(cacheKey, text, { httpMetadata: { contentType: 'text/plain' } })
    return jsonResponse({ text, cached: false })
  } catch(error) {
    const code=FAILURE_CODES.has(error?.code)?error.code:'PROVIDER_UNAVAILABLE';
    if(code!=='REQUEST_CANCELLED'){
      // Diagnostic metadata only: never persist prompts, raw provider bodies or keys.
      const diagnostic={code,at:new Date().toISOString(),...(Number.isInteger(error?.httpStatus)?{httpStatus:error.httpStatus}:{})};
      try{await env.BUCKET.put(FAILURE_KEY,JSON.stringify(diagnostic))}catch{}
    }
    return jsonResponse({error:code==='CONTEXT_LIMIT'?'The provider could not accept the full personal history. Nothing was discarded.':'Model response unavailable.',code},code==='CONTEXT_LIMIT'?413:503)
  }
}
