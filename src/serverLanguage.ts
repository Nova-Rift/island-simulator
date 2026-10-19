import type { ChatMessage, IslandLanguageModel } from './islandLanguage.ts'

// Provider credentials stay in the Site Worker. No model download on the device.
export class ServerLanguageModel implements IslandLanguageModel {
  private controller = new AbortController()
  async load() {
    const response = await fetch('/api/island/status', { signal: this.controller.signal })
    if (!response.ok) throw new Error('Server conversations are temporarily unavailable.')
    return 'Runpod AI'
  }
  async generate(messages: ChatMessage[], json: boolean, schema?:Record<string,unknown>) {
    const response = await fetch('/api/island/dialogue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, json, ...(schema?{schema}:{}) }), credentials: 'same-origin',
      signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(125000)]),
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
