// Server-only transport. Never import this module or its credentials into src/.
// A validated, budget-limited server route must call this; it is NOT a public proxy.
export const MODEL = 'Qwen/Qwen3-32B-AWQ'
export const ENDPOINT = 'qwen3-32b-awq'
export const MAX_REQUEST_BYTES = 262144
export function contextError(){return Object.assign(new Error('Full personal history could not fit or was rejected. Nothing was discarded.'),{code:'CONTEXT_LIMIT'})}
export const MAX_OUTPUT_TOKENS = 96
export function createRunpodClient({ apiKey, endpointId = ENDPOINT, model = MODEL, fetchImpl = fetch }) {
  if (!apiKey || !/^[a-zA-Z0-9_-]{1,128}$/.test(endpointId || '')) throw new Error('Runpod server credentials and endpoint ID are required')
  const url = `https://api.runpod.ai/v2/${endpointId}/openai/v1/chat/completions`
  return {
    async generate(messages, json = false, signal, schema) {
      if (!Array.isArray(messages) || messages.length < 1 || messages.length > 20 ||
          messages.some(m => !['system','user','assistant'].includes(m?.role) || typeof m.content !== 'string')) throw new Error('Invalid dialogue request')
      if(new TextEncoder().encode(JSON.stringify({messages,json,schema})).length>MAX_REQUEST_BYTES)throw contextError()
      const timeout = AbortSignal.timeout(120000)
      const response = await fetchImpl(url, {
        method: 'POST', redirect: 'error', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'User-Agent': 'research-lab-island/1.0' },
        body: JSON.stringify({ model, messages, ...(schema?{response_format:{type:"json_schema",json_schema:{name:"legal_action",strict:true,schema}}}:{}), truncate_prompt_tokens: null, max_tokens: MAX_OUTPUT_TOKENS, temperature: json ? 0.2 : 0.7, stream: false, chat_template_kwargs: { enable_thinking: false } }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
      // Do not forward provider errors: these may contain sensitive configuration.
      if (response.status===400 || response.status===413)throw contextError()
      if (!response.ok) throw new Error(`Runpod inference failed (HTTP ${response.status})`)
      const result = await response.json()
      const text = result?.choices?.[0]?.message?.content
      if (typeof text !== 'string' || !text.trim()) throw Object.assign(new Error('Runpod returned no dialogue'),{code:'EMPTY_RESPONSE'})
      if (text.includes('<think>') || result.choices[0].finish_reason === 'length') throw Object.assign(new Error('Runpod returned an incomplete response'),{code:'INCOMPLETE_RESPONSE'})
      // Some instruction models wrap otherwise valid JSON in a Markdown fence.
      const cleaned = json ? text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1').trim() : text.trim()
      if (json) {try{JSON.parse(cleaned)}catch{throw Object.assign(new Error('Model returned invalid JSON'),{code:'INVALID_JSON'})}}
      return cleaned
    },
  }
}
