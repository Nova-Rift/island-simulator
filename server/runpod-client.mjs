// Server-only transport. Never import this module or its credentials into src/.
// A validated, budget-limited server route must call this; it is NOT a public proxy.
export const MODEL = 'ibm-granite/granite-4.0-h-small'
export const ENDPOINT = 'granite-4-0-h-small'
export const MAX_REQUEST_BYTES = 262144
export function contextError(){return Object.assign(new Error('Full personal history could not fit or was rejected. Nothing was discarded.'),{code:'CONTEXT_LIMIT'})}
function providerError(code,message,httpStatus) {return Object.assign(new Error(message),{code,...httpStatus?{httpStatus}:{}})}
function checkResponse(response,stage) {
 if(response.ok)return;
 const status=response.status;
 if(status===413)throw contextError();
 const code=status===400?'PROVIDER_REQUEST_REJECTED':[401,403].includes(status)?'PROVIDER_AUTH':status===402?'PROVIDER_BILLING':status===429?'PROVIDER_RATE_LIMIT':status===404?'PROVIDER_NOT_FOUND':status>=500?'PROVIDER_UNAVAILABLE':'PROVIDER_REQUEST_REJECTED';
 throw providerError(code,`Runpod ${stage} failed (HTTP ${status})`,status);
}
export const MAX_OUTPUT_TOKENS = 96
export function createRunpodClient({ apiKey, endpointId = ENDPOINT, model = MODEL, fetchImpl = fetch }) {
  if (!apiKey || !/^[a-zA-Z0-9_-]{1,128}$/.test(endpointId || '')) throw new Error('Runpod server credentials and endpoint ID are required')
  const url = `https://api.runpod.ai/v2/${endpointId}/runsync`
  return {
    async generate(messages, json = false, signal, schema) {
      if (!Array.isArray(messages) || messages.length < 1 || messages.length > 20 ||
          messages.some(m => !['system','user','assistant'].includes(m?.role) || typeof m.content !== 'string')) throw new Error('Invalid dialogue request')
      if(new TextEncoder().encode(JSON.stringify({messages,json,schema})).length>MAX_REQUEST_BYTES)throw contextError()
      const timeout = AbortSignal.timeout(120000)
      const requestBody = { model, messages, ...(schema?{response_format:{type:"json_schema",json_schema:{name:"legal_action",strict:true,schema}}}:{}), truncate_prompt_tokens: null, max_tokens: schema?.type==='integer'?8:MAX_OUTPUT_TOKENS, temperature: json ? 0.2 : 0.7, stream: false }
      const transport=async(url,options)=>{
        try{return await fetchImpl(url,options)}catch(error){
          const reason=options.signal?.reason;
          if(reason?.name==='TimeoutError'||error?.name==='TimeoutError')throw providerError('PROVIDER_TIMEOUT','Runpod did not finish within 120 seconds');
          if(options.signal?.aborted)throw providerError('REQUEST_CANCELLED','Request cancelled');
          throw providerError('PROVIDER_NETWORK','Could not reach Runpod');
        }
      };
      const response = await transport(url, {
        method: 'POST', redirect: 'error', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'User-Agent': 'research-lab-island/1.0' },
        body: JSON.stringify({input:{openai_route:'/v1/chat/completions',openai_input:requestBody}}),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
      // Do not forward provider errors: these may contain sensitive configuration.
      checkResponse(response,'inference');
      let job = await response.json()
      while(['IN_QUEUE','IN_PROGRESS'].includes(job.status)){
        if(typeof job.id!=='string'||!/^[a-zA-Z0-9_-]+$/.test(job.id))throw new Error('Invalid Runpod job ID')
        await new Promise(resolve=>setTimeout(resolve,500))
        const polled=await transport(`https://api.runpod.ai/v2/${endpointId}/status/${job.id}`,{headers:{Authorization:`Bearer ${apiKey}`,'User-Agent':'research-lab-island/1.0'},signal:signal?AbortSignal.any([signal,timeout]):timeout,redirect:'error'})
        checkResponse(polled,'status')
        job=await polled.json()
      }
      if(job.status&&job.status!=='COMPLETED')throw providerError(job.status==='TIMED_OUT'?'PROVIDER_TIMEOUT':'PROVIDER_JOB_FAILED','Runpod job did not complete')
      const result=job.output?(Array.isArray(job.output)?job.output[0]:job.output):job
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
