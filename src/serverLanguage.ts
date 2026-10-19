import type { ChatMessage, IslandLanguageModel } from './islandLanguage.ts'

// Credentials stay on the loopback server, never in the browser bundle.
export class ServerLanguageModel implements IslandLanguageModel {
  constructor(private provider:'runpod'|'openai'='runpod') {}
  private controller = new AbortController()
  async load() {
    const response = await fetch('/api/island/status', { signal: this.controller.signal })
    if (!response.ok) throw new Error('Server conversations are temporarily unavailable.')
    const status=await response.json()
    if(status.providers && !status.providers[this.provider]?.ready)throw Object.assign(new Error('Provider is not configured'),{code:'PROVIDER_NOT_CONFIGURED'})
    return this.provider==='openai'?'OpenAI GPT-6 Astra':'Runpod AI'
  }
  async generate(messages: ChatMessage[], json: boolean, schema?:Record<string,unknown>) {
    const response = await fetch('/api/island/dialogue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider:this.provider, messages, json, ...(schema?{schema}:{}) }), credentials: 'same-origin',
      signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(125000)]),
    }).catch(error=>{
      if(this.controller.signal.aborted)throw error
      throw Object.assign(new Error('Local model connection failed'),{code:error?.name==='TimeoutError'?'PROVIDER_TIMEOUT':'LOCAL_CONNECTION'})
    })
    if (!response.ok) {
      const data=await response.json().catch(()=>({})) as {code?:string}
      const code=data.code||(response.status===413?'CONTEXT_LIMIT':response.status===429?'BUDGET_LIMIT':'PROVIDER_UNAVAILABLE')
      throw Object.assign(new Error(code),{code})
    }
    const result = await response.json() as {text?: string}
    if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('No server dialogue received')
    return result.text
  }
  dispose() { this.controller.abort() }
}
