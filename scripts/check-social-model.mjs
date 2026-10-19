// Explicit bounded PAID smoke test against an already running local server.
// No key is read here. The loopback server owns credentials, cache and allowance.
import assert from 'node:assert/strict'
import {SocialGame} from '../src/social.mjs'
import {decisionPrompt,summaryPrompt,parseDecision} from '../src/socialPolicy.ts'
const origin='http://127.0.0.1:4174'
async function generate(messages){const r=await fetch(origin+'/api/island/dialogue',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({messages,json:true})});assert.equal(r.status,200);return (await r.json()).text}
const game=new SocialGame()
let obs=game.observe();const first=parseDecision(await generate(decisionPrompt(obs)),obs)
console.log('Initial choice:',first.type)
game.step({type:'invite',target:1});game.step({type:'join',group:1})
obs=game.observe();assert.ok(obs.legal.some(a=>a.type==='request'))
const next=parseDecision(await generate(decisionPrompt(obs)),obs);console.log('Outsider with join-request option:',next.type)
const summary=JSON.parse(await generate(summaryPrompt(game.observe(0))));assert.ok(typeof summary.summary==='string'&&summary.summary.trim());console.log('Intention summary: valid')
while(game.phase!=='vote')game.step({type:'pass'})
obs=game.observe();const vote=parseDecision(await generate(decisionPrompt(obs)),obs);assert.equal(vote.type,'vote');assert.notEqual(vote.target,obs.agent);console.log('Mandatory non-self vote: valid')
