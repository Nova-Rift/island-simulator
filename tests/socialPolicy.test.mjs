import test from 'node:test';import assert from 'node:assert/strict';
import {SocialGame} from '../src/social.mjs';
import {scriptedDecision,decisionPrompt,summaryPrompt,parseDecision,parseAssessment,gameReviewPrompt,chooseModelDecision} from '../src/socialPolicy.ts';
test('scripted walkthrough shows voluntary refusal, requests, consent, speech and leave before voting',()=>{
 const g=new SocialGame();const events=[];
 while(g.cycle===1&&!g.done){const o=g.observe();events.push(g.step(scriptedDecision(o)).event);}
 for(const type of ['invite','join','decline','request','admit','deny','say','leave','pass','vote'])assert.ok(events.some(e=>e.type===type),type);
 assert.equal(events.filter(e=>e.type==='vote').length,8);assert.equal(g.remaining.length,7);
});
test('model prompts contain only the observation; outsiders never receive private speech or intentions',()=>{
 const g=new SocialGame();while(g.turn<14)g.step(scriptedDecision(g.observe()));
 const frame=g.frame(),secret=frame.events.find(e=>e.type==='say').text;
 assert.ok(JSON.stringify(decisionPrompt(g.observe(0))).includes(secret));
 assert.ok(!JSON.stringify(decisionPrompt(g.observe(5))).includes(secret));
 assert.ok(!JSON.stringify(summaryPrompt(g.observe(5))).includes(secret));
 const o=g.observe();assert.throws(()=>parseDecision('{"type":"say","text":"cheat"}',{...o,legal:[{type:'pass'}]}));
 assert.deepEqual(parseDecision('{"type":"pass"}',{...o,legal:[{type:'pass'}]}).type,'pass');
});
test('full scripted game ends reproducibly with one winner and no network',()=>{
 const run=()=>{const g=new SocialGame();while(!g.done)g.step(scriptedDecision(g.observe()));return g.frame()};
 const a=run();assert.deepEqual(a,run());assert.equal(a.councils.length,7);assert.equal(a.rewards.reduce((x,y)=>x+y),1);
});
test('decision and summary prompts preserve the earliest events and all private records past both old windows',()=>{
 const o=new SocialGame().observe();o.heard=Array.from({length:50},(_,i)=>({turn:i,text:`PERSONAL_MEMORY_${i}`}));o.ownDecisions=[{turn:1,action:{type:'vote',target:7,reason:'old private vote'}}];o.intentions=[{turn:1,text:'old intention'}]
 for(const prompt of [decisionPrompt(o),summaryPrompt(o)]){
  const data=JSON.parse(prompt[1].content);assert.deepEqual(data.heard,o.heard);assert.deepEqual(data.ownDecisions,o.ownDecisions);assert.deepEqual(data.intentions,o.intentions)
 }
});

test('assessment requires a finite subjective probability and usable summary',()=>{
 assert.deepEqual(parseAssessment('{"summary":"An ally may help.","winProbability":0.42}'),{summary:'An ally may help.',winProbability:0.42});
 for(const winProbability of [-1,2,null,'0.5'])assert.throws(()=>parseAssessment(JSON.stringify({summary:'test',winProbability})));
 assert.throws(()=>parseAssessment('{"summary":"" ,"winProbability":0.5}'));
});

test('post-game reviewer receives every event and ballot only after completion',()=>{
 const g=new SocialGame();assert.throws(()=>gameReviewPrompt(g.frame(),0));
 while(!g.done)g.step(scriptedDecision(g.observe()));
 const frame=g.frame(),payload=JSON.parse(gameReviewPrompt(frame,3)[1].content);
 assert.deepEqual(payload.game,frame);assert.equal(payload.player,3);
 assert.equal(payload.game.councils.length,7);assert.ok(payload.game.events.length>100);
});

test('irrelevant model fields do not invalidate a legal choice or reach the engine',()=>{
 const o=new SocialGame().observe();
 const action=parseDecision('{"type":"invite","target":2,"group":1,"text":"not speech"}',o);
 assert.equal(action.type,'invite');assert.equal(action.target,2);assert.equal(action.group,undefined);assert.equal(action.text,undefined);
 const g=new SocialGame();g.step(action,'llm');assert.equal(g.frame().events[0].source,'llm');
 assert.throws(()=>parseDecision('{"type":"invite","target":0,"group":1}',o));
 assert.throws(()=>parseDecision('{"type":"join","group":1,"target":2}',o));
 assert.throws(()=>parseDecision('{"type":"say","text":"not in a group"}',o));
 const join={...o,legal:[{type:'join',group:3}]};
 assert.equal(parseDecision('{"type":"join","group":3,"target":0}',join).target,undefined);
 assert.throws(()=>parseDecision('{"type":"join","group":4}',join));
});

test('one corrective model request keeps all personal context and never replaces a choice with rules',async()=>{
 const o=new SocialGame().observe();let calls=[];
 const model={generate:async messages=>{calls.push(messages);return calls.length===1?'Configuration error':JSON.stringify({type:'invite',target:1})}};
 const action=await chooseModelDecision(model,o);assert.equal(action.target,1);assert.equal(calls.length,2);
 const repaired=JSON.parse(calls[1][1].content);const {correction,...personal}=repaired;assert.deepEqual(personal,o);assert.equal(correction.rejectedReply,'Configuration error');
 calls=[];model.generate=async messages=>{calls.push(messages);return '{"type":"invite","target":0}'};
 await assert.rejects(chooseModelDecision(model,o),/correction also failed/);assert.equal(calls.length,2);
 calls=[];model.generate=async messages=>{calls.push(messages);throw Object.assign(Error('budget'),{code:'BUDGET_LIMIT'})};
 await assert.rejects(chooseModelDecision(model,o),e=>e.code==='BUDGET_LIMIT');assert.equal(calls.length,1);
});
