import test from 'node:test'
import assert from 'node:assert/strict'
import { createRunpodClient, MAX_REQUEST_BYTES } from '../server/runpod-client.mjs'
test('server transport pins Runpod origin, bounds output, and keeps credential in authorization header', async () => {
  let request
  const client=createRunpodClient({apiKey:'test-secret',endpointId:'test-endpoint',fetchImpl:async(url,options)=>{
    request={url,options};return Response.json({choices:[{message:{content:'Theo, can we share food?'}}]})
  }})
  assert.equal(await client.generate([{role:'user',content:'Speak.'}]),'Theo, can we share food?')
  assert.equal(request.url,'https://api.runpod.ai/v2/test-endpoint/openai/v1/chat/completions')
  assert.equal(request.options.headers.Authorization,'Bearer test-secret')
  assert.equal(JSON.parse(request.options.body).max_tokens,96)
  assert.ok(!request.options.body.includes('test-secret'))
  assert.throws(()=>createRunpodClient({apiKey:'test-secret',endpointId:'https://other.invalid'}))
})
test('invalid requests never reach paid inference, and provider errors do not leak details', async () => {
  let calls=0
  const client=createRunpodClient({apiKey:'test-secret',endpointId:'test',fetchImpl:async()=>{calls++;return new Response('sensitive provider details',{status:500})}})
  await assert.rejects(client.generate([{role:'user',content:'x'.repeat(MAX_REQUEST_BYTES+1)}]),e=>e.code==='CONTEXT_LIMIT')
  assert.equal(calls,0)
  await assert.rejects(client.generate([{role:'user',content:'Speak.'}]),error=>error.message==='Runpod inference failed (HTTP 500)')
  assert.equal(calls,1)
})
test('empty provider output is rejected rather than shown as successful dialogue', async () => {
  const client=createRunpodClient({apiKey:'test-secret',endpointId:'test',fetchImpl:async()=>Response.json({choices:[]})})
  await assert.rejects(client.generate([{role:'user',content:'Speak.'}]),/no dialogue/)
})
test('JSON fences are normalized; truncated responses never become successful state', async () => {
  const client=createRunpodClient({apiKey:'test-secret',fetchImpl:async()=>Response.json({choices:[{message:{content:'```json\n{"summary":"Share fruit."}\n```'},finish_reason:'stop'}]})})
  assert.equal(await client.generate([{role:'user',content:'Summary.'}],true),'{"summary":"Share fruit."}')
  const truncated=createRunpodClient({apiKey:'test-secret',fetchImpl:async()=>Response.json({choices:[{message:{content:'unfinished'},finish_reason:'length'}]})})
  await assert.rejects(truncated.generate([{role:'user',content:'Speak.'}]),/incomplete/)
})
test('large history is forwarded intact with truncation disabled; provider rejection is explicit and private',async()=>{
 const content='EARLIEST_MEMORY '+ 'historical context '.repeat(1800)+' LAST_MEMORY';let request
 const client=createRunpodClient({apiKey:'test-secret',fetchImpl:async(_url,options)=>{request=JSON.parse(options.body);return Response.json({choices:[{message:{content:'ok'},finish_reason:'stop'}]})}})
 await client.generate([{role:'user',content}]);assert.equal(request.messages[0].content,content);assert.equal(request.truncate_prompt_tokens,null)
 const rejected=createRunpodClient({apiKey:'test-secret',fetchImpl:async()=>new Response('sensitive provider body',{status:400})})
 await assert.rejects(rejected.generate([{role:'user',content}]),e=>e.code==='CONTEXT_LIMIT'&&!e.message.includes('sensitive'))
});
