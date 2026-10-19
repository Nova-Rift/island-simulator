import test from 'node:test';import assert from 'node:assert/strict';
import {SocialGame} from '../src/social.mjs';
import {scriptedDecision,decisionPrompt,summaryPrompt,parseDecision} from '../src/socialPolicy.ts';
test('scripted walkthrough shows voluntary refusal, requests, consent, speech, exclusion and leave before voting',()=>{
 const g=new SocialGame();const events=[];
 while(g.cycle===1&&!g.done){const o=g.observe();events.push(g.step(scriptedDecision(o)).event);}
 for(const type of ['invite','join','decline','request','admit','deny','say','exclude','agree','leave','pass','vote'])assert.ok(events.some(e=>e.type===type),type);
 const expel=events.find(e=>e.type==='agree');assert.match(expel.text,/excludes Iris/);
 assert.equal(events.filter(e=>e.type==='vote').length,8);assert.equal(g.remaining.length,7);
});
test('model prompts contain only the observation; outsiders never receive private speech or intentions',()=>{
 const g=new SocialGame();while(g.turn<14)g.step(scriptedDecision(g.observe()));
 const frame=g.frame(),secret=frame.events.find(e=>e.type==='say').text;
 assert.ok(JSON.stringify(decisionPrompt(g.observe(3))).includes(secret));
 assert.ok(!JSON.stringify(decisionPrompt(g.observe(5))).includes(secret));
 assert.ok(!JSON.stringify(summaryPrompt(g.observe(5))).includes(secret));
 const o=g.observe();assert.throws(()=>parseDecision('{"type":"say","text":"cheat"}',{...o,legal:[{type:'pass'}]}));
 assert.deepEqual(parseDecision('{"type":"pass"}',{...o,legal:[{type:'pass'}]}).type,'pass');
});
test('full scripted game ends reproducibly with one winner and no network',()=>{
 const run=()=>{const g=new SocialGame();while(!g.done)g.step(scriptedDecision(g.observe()));return g.frame()};
 const a=run();assert.deepEqual(a,run());assert.equal(a.councils.length,7);assert.equal(a.rewards.reduce((x,y)=>x+y),1);
});
