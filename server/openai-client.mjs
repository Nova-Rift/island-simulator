// Server-only Responses adapter. Each request supplies the agent's full private history.
export const OPENAI_MODEL='gpt-6-astra'
export const OPENAI_MAX_OUTPUT=2048 // Includes reasoning tokens; incomplete outputs fail closed.
const failure=code=>Object.assign(new Error(code),{code})
export function createOpenAIClient({apiKey,fetchImpl=fetch}) {
 return {async generate(messages,json=false,signal,schema){
  const scalar=schema?.type==='integer'
  const outputSchema=scalar?{type:'object',properties:{choice:schema},required:['choice'],additionalProperties:false}:schema
  const format=outputSchema?{type:'json_schema',name:'agent_decision',strict:true,schema:outputSchema}:json?{type:'json_object'}:null
  let response
  try{
   response=await fetchImpl('https://api.openai.com/v1/responses',{
    method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
    signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(120000)]),
    body:JSON.stringify({model:OPENAI_MODEL,store:false,reasoning:{effort:'low'},max_output_tokens:OPENAI_MAX_OUTPUT,
     input:messages.map(m=>({...m,role:m.role==='system'?'developer':m.role})),...(format?{text:{format}}:{})})
   })
  }catch(error){throw failure(signal?.aborted?'REQUEST_CANCELLED':error?.name==='TimeoutError'?'PROVIDER_TIMEOUT':'PROVIDER_NETWORK')}
  if(!response.ok){const error=failure(({400:'PROVIDER_REQUEST_REJECTED',401:'PROVIDER_AUTH',403:'PROVIDER_AUTH',402:'PROVIDER_BILLING',404:'PROVIDER_NOT_FOUND',413:'CONTEXT_LIMIT',429:'PROVIDER_RATE_LIMIT'})[response.status]||'PROVIDER_UNAVAILABLE');error.httpStatus=response.status;throw error}
  let data;try{data=await response.json()}catch{throw failure('INVALID_JSON')}
  if(data.status!=='completed')throw failure('INCOMPLETE_RESPONSE')
  const text=(data.output||[]).filter(item=>item.type==='message').flatMap(item=>item.content||[]).filter(item=>item.type==='output_text').map(item=>item.text).join('').trim()
  if(!text)throw failure('EMPTY_RESPONSE')
  if(json){let parsed;try{parsed=JSON.parse(text)}catch{throw failure('INVALID_JSON')}
   if(scalar){if(!Number.isInteger(parsed.choice)||!schema.enum.includes(parsed.choice))throw failure('INVALID_JSON');return JSON.stringify(parsed.choice)}
  }
  return text
 }}
}
