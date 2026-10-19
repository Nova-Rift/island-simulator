import test from 'node:test'
import assert from 'node:assert/strict'
import {createOpenAIClient,OPENAI_MODEL,OPENAI_MAX_OUTPUT} from '../server/openai-client.mjs'
import {dialogueRoute} from '../server/dialogue.mjs'
const messages=[{role:'system',content:'Return JSON.'},{role:'user',content:'Full oldest to newest personal history'}]
const output=text=>Response.json({status:'completed',output:[{type:'reasoning',summary:[]},{type:'message',content:[{type:'output_text',text}]}]})
test('Astra uses Responses, private full history, low reasoning and strict object-wrapped choices',async()=>{
 const client=createOpenAIClient({apiKey:'private-key',fetchImpl:async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.headers.Authorization,'Bearer private-key')
  const body=JSON.parse(options.body);assert.equal(body.model,OPENAI_MODEL);assert.equal(body.store,false);assert.equal(body.reasoning.effort,'low');assert.equal(body.max_output_tokens,OPENAI_MAX_OUTPUT)
  assert.equal(body.input[0].role,'developer');assert.equal(body.input[1].content,messages[1].content)
  assert.equal(body.temperature,undefined);assert.equal(body.previous_response_id,undefined)
  assert.deepEqual(body.text.format.schema.properties.choice,{type:'integer',enum:[0,2]})
  return output('{"choice":2}')
 }})
 assert.equal(await client.generate(messages,true,undefined,{type:'integer',enum:[0,2]}),'2')
})
test('Astra malformed, out-of-range, incomplete and auth responses fail without retry',async()=>{
 for(const [response,code] of [[output('bad'),'INVALID_JSON'],[output('{"choice":9}'),'INVALID_JSON'],[Response.json({status:'incomplete'}),'INCOMPLETE_RESPONSE'],[new Response('secret raw body',{status:401}),'PROVIDER_AUTH']]){
  let count=0;const client=createOpenAIClient({apiKey:'secret',fetchImpl:async()=>{count++;return response}})
  await assert.rejects(client.generate(messages,true,undefined,{type:'integer',enum:[0,2]}),error=>error.code===code&&!error.message.includes('secret'));assert.equal(count,1)
 }
})
class Store{
 map=new Map();async get(k){const v=this.map.get(k);return v===undefined?null:{etag:'1',text:async()=>v,json:async()=>JSON.parse(v)}}
 async put(k,v){this.map.set(k,v);return {etag:'1'}}
}
const request=provider=>new Request('http://127.0.0.1:4174/api/island/dialogue',{method:'POST',headers:{Origin:'http://127.0.0.1:4174','Content-Type':'application/json'},body:JSON.stringify({provider,messages,json:true})})
test('provider routing isolates caches, preserves old reservations, and fails closed without selected key',async()=>{
 const bucket=new Store(),env={BUCKET:bucket,RUNPOD_INFERENCE_KEY:'runpod-secret'};let count=0
 const mock=async(url,options)=>{count++;if(url.includes('openai.com')){assert.equal(options.headers.Authorization,'Bearer openai-secret');return output('{"summary":"openai"}')}
 return Response.json({choices:[{message:{content:'{"summary":"runpod"}'},finish_reason:'stop'}]})}
 assert.equal((await dialogueRoute(request('openai'),env,mock)).status,503);assert.equal(count,0)
 await bucket.put('island-v1/reservations.json',JSON.stringify({tokens:12345,requests:1,minute:0,minuteRequests:0}))
 env.OPENAI_API_KEY='openai-secret'
 assert.equal((await (await dialogueRoute(request('runpod'),env,mock)).json()).text,'{"summary":"runpod"}')
 const before=JSON.parse(bucket.map.get('island-v1/reservations.json')).tokens
 assert.equal((await (await dialogueRoute(request('openai'),env,mock)).json()).text,'{"summary":"openai"}')
 const after=JSON.parse(bucket.map.get('island-v1/reservations.json')).tokens
 assert.equal(after-before,(new TextEncoder().encode(JSON.stringify({messages})).length+1024)*10+OPENAI_MAX_OUTPUT*50)
 assert.equal((await (await dialogueRoute(request('openai'),env,mock)).json()).cached,true);assert.equal(count,2)
 assert.equal((await dialogueRoute(request('invalid'),env,mock)).status,400);assert.equal(count,2)
 assert.ok(!JSON.stringify([...bucket.map]).includes('secret'))
})
