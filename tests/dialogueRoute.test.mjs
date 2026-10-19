import { MAX_REQUEST_BYTES } from '../server/runpod-client.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { dialogueRoute, reserveBudget, TOKEN_BUDGET, validateDialogue } from '../server/dialogue.mjs'

export class MemoryBucket {
  objects = new Map()
  revision = 0
  async get(key) {
    const object = this.objects.get(key)
    return object ? { etag: object.etag, text: async () => object.value, json: async () => JSON.parse(object.value) } : null
  }
  async put(key, value, options = {}) {
    const old = this.objects.get(key)
    if (options.onlyIf?.etagMatches && old?.etag !== options.onlyIf.etagMatches) return null
    if (options.onlyIf instanceof Headers && options.onlyIf.get('If-None-Match') === '*' && old) return null
    const object = { etag: String(++this.revision), value }
    this.objects.set(key, object)
    return object
  }
}
const data = { messages: [{ role:'system', content:'You write natural dialogue for characters in an island survival game.' }, { role:'user', content:'Maya asks Theo to share fruit.' }], json:false }
function request(body = data, origin = 'https://example.com') {
  return new Request('https://example.com/api/island/dialogue', { method:'POST', headers:{ 'Origin':origin, 'Content-Type':'application/json' }, body:JSON.stringify(body) })
}
function env() { return { BUCKET:new MemoryBucket(), RUNPOD_INFERENCE_KEY:'secret-not-for-browser' } }
test('invalid/oversized/cross-origin requests never reach paid inference', async () => {
  const settings = env(); let calls = 0
  const provider = () => { calls++; throw new Error('Should not call provider') }
  assert.equal((await dialogueRoute(request(data, 'https://other.invalid'), settings, provider)).status,403)
  assert.equal((await dialogueRoute(request({...data,messages:[]}), settings, provider)).status,400)
  assert.equal((await dialogueRoute(request({...data,extra:'x'.repeat(MAX_REQUEST_BYTES+1)}), settings, provider)).status,413)
  assert.equal(calls,0)
  for (const name of ['Maya','Theo','Nia','Leo','Ava','Sam','Iris','Kai'])
    assert.equal(validateDialogue({...data,messages:[{role:'system',content:`You are ${name} in a fictional island game.`},data.messages[1]]}),true)
})
test('successful model responses are cached and neither cache nor responses contain credentials', async () => {
  const settings=env();let calls=0
  const provider=async()=>{calls++;return Response.json({choices:[{message:{content:'Let us share the fruit.'},finish_reason:'stop'}]})}
  const first=await dialogueRoute(request(),settings,provider)
  assert.deepEqual(await first.json(),{text:'Let us share the fruit.',cached:false})
  const second=await dialogueRoute(request(),settings,provider)
  assert.deepEqual(await second.json(),{text:'Let us share the fruit.',cached:true})
  assert.equal(calls,1)
  assert.ok(!JSON.stringify([...settings.BUCKET.objects]).includes(settings.RUNPOD_INFERENCE_KEY))
})
test('concurrent isolates cannot overspend the durable reservation budget', async () => {
  const bucket=new MemoryBucket()
  const results=await Promise.all(Array.from({length:16},()=>reserveBudget(bucket,TOKEN_BUDGET/2)))
  assert.equal(results.filter(Boolean).length,2)
  assert.equal((await (await bucket.get('island-v1/reservations.json')).json()).tokens,TOKEN_BUDGET)
})
test('budget exhaustion and storage failure fail closed; failures consume their reservation', async () => {
  const settings=env();let calls=0
  const provider=async()=>{calls++;return new Response('secret provider details',{status:500})}
  const failure=await dialogueRoute(request(),settings,provider)
  assert.equal(failure.status,503)
  assert.ok(!(await failure.text()).includes('secret'))
  assert.ok((await (await settings.BUCKET.get('island-v1/reservations.json')).json()).tokens>0)
  const old=await settings.BUCKET.get('island-v1/reservations.json')
  await settings.BUCKET.put('island-v1/reservations.json',JSON.stringify({...(await old.json()),tokens:TOKEN_BUDGET}))
  const limited=await dialogueRoute(request(),settings,provider);assert.equal(limited.status,429);assert.equal((await limited.json()).code,'BUDGET_LIMIT')
  assert.equal(calls,1)
  settings.BUCKET.get=async()=>{throw new Error('Unavailable')}
  assert.equal((await dialogueRoute(request(),settings,provider)).status,503)
  assert.equal(calls,1)
})
test('over-12KB personal history reaches provider unchanged; context rejection is 413 with no reduced retry',async()=>{
 const settings=env(),long={...data,messages:[data.messages[0],{role:'user',content:'OLDEST '+ 'memory '.repeat(3000)+' NEWEST'}]};let calls=0
 const provider=async(_url,options)=>{calls++;assert.deepEqual(JSON.parse(options.body).input.openai_input.messages,long.messages);return new Response('private provider rejection',{status:400})}
 const response=await dialogueRoute(request(long),settings,provider);assert.equal(response.status,413);assert.equal((await response.json()).code,'CONTEXT_LIMIT');assert.equal(calls,1)
});

test('editable decision prompts and outside-reviewer prompts are accepted locally',()=>{
 for(const content of ['Play cautiously, {name}.','You are reviewing a completed fictional social voting game.'])assert.equal(validateDialogue({...data,messages:[{role:'system',content},data.messages[1]]}),true);
 assert.equal(validateDialogue({...data,messages:[{role:'system',content:' '},data.messages[1]]}),false);
});

test('expanded task allowance preserves prior reservations and permits continued local play',async()=>{
 const bucket=new MemoryBucket();await bucket.put('island-v1/reservations.json',JSON.stringify({tokens:999636,requests:231,minute:0,minuteRequests:0}));
 assert.equal(TOKEN_BUDGET,5000000);
 assert.equal(await reserveBudget(bucket,20000),true);
 const state=await (await bucket.get('island-v1/reservations.json')).json();
 assert.equal(state.tokens,1019636);assert.equal(state.requests,232);
});

test('schema requests bypass unconstrained cache and reserve schema overhead',async()=>{
 const settings=env();let calls=0;
 const provider=async(_url,options)=>{calls++;const body=JSON.parse(options.body).input.openai_input;if(calls===2)assert.equal(body.response_format.json_schema.schema.properties.choice.enum[0],1);return Response.json({choices:[{message:{content:'{"choice":1}'},finish_reason:'stop'}]})};
 const json={...data,json:true};await dialogueRoute(request(json),settings,provider);
 const schema={type:'object',properties:{choice:{type:'integer',enum:[1]}}};await dialogueRoute(request({...json,schema}),settings,provider);
 assert.equal(calls,2);await dialogueRoute(request({...json,schema}),settings,provider);assert.equal(calls,2);
});

test('all eight concurrent agent requests can reserve within budget',async()=>{
 const bucket=new MemoryBucket();const reservations=await Promise.all(Array.from({length:8},()=>reserveBudget(bucket,5000)));
 assert.equal(reservations.filter(Boolean).length,8);assert.equal((await(await bucket.get('island-v1/reservations.json')).json()).tokens,40000);
});
