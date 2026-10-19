import test from 'node:test';import assert from 'node:assert/strict';
import {SocialGame} from '../src/social.mjs';
import {scriptedDecision,decisionPrompt,summaryPrompt,parseDecision,parseAssessment,gameReviewPrompt,chooseModelDecision,rankingPrompt,parseRanking,reviewStandings} from '../src/socialPolicy.ts';
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
 const a=run();assert.deepEqual(a,run());assert.equal(a.councils.length,6);assert.equal(a.rewards.reduce((x,y)=>x+y),1);
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

test('viewer recap supports snapshots without inventing outcomes or entering agent memory',()=>{
 const g=new SocialGame();const before=g.observe();const partial=gameReviewPrompt(g.frame(),0);assert.match(partial[0].content,/game is not over/);assert.match(partial[0].content,/do not invent a winner/);assert.deepEqual(g.observe(),before);assert.equal(JSON.parse(partial[1].content).game.winner,null);
 while(!g.done)g.step(scriptedDecision(g.observe()));
 const frame=g.frame(),payload=JSON.parse(gameReviewPrompt(frame,3)[1].content);
 assert.deepEqual(payload.game,frame);assert.equal(payload.player,3);
 assert.equal(payload.game.councils.length,6);assert.ok(payload.game.events.length>100);
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

test('constrained choices map exactly to legal actions and cannot override targets',async()=>{
 const o=new SocialGame().observe();let calls=0;
 const model={generate:async(messages,json,schema)=>{calls++;assert.deepEqual(schema.enum,o.legal.map((_,i)=>i));const {choices,...personal}=JSON.parse(messages[1].content);assert.deepEqual(personal,o);return '1'}};
 const action=await chooseModelDecision(model,o);assert.equal(action.target,1);assert.equal(action.group,undefined);assert.equal(calls,1);
 model.generate=async()=>'999';await assert.rejects(chooseModelDecision(model,o),/valid constrained choice/);
 model.generate=async()=>{throw Object.assign(Error('budget'),{code:'BUDGET_LIMIT'})};await assert.rejects(chooseModelDecision(model,o),e=>e.code==='BUDGET_LIMIT');
});

test('decision and speech prompts name only accepted current listeners, updating after joins and leaves',async()=>{
 const g=new SocialGame({concurrent:true});g.step({type:'invite',target:1},'agent',0);
 assert.match(decisionPrompt(g.observe(0))[0].content,/on your own: no conversation listeners/);
 g.step({type:'join',group:1},'agent',1);g.step({type:'invite',target:2},'agent',0);
 const o=g.observe(0),prompt=decisionPrompt(o)[0].content;
 assert.match(prompt,/2 participants: you \(Maya\) and Theo/);assert.match(prompt,/one-to-one conversation/);
 assert.doesNotMatch(prompt,/Only .*Nia.*can hear/);
 const captured=[];
 await chooseModelDecision({generate:async(messages,json,schema)=>{
  captured.push(messages);return schema?String(o.legal.findIndex(a=>a.type==='say')):JSON.stringify({text:'Theo, who do you trust?'});
 }},o,'Custom instructions for {name}.');
 assert.match(captured[0][0].content,/Only Theo can hear/);
 assert.match(captured[1][0].content,/Address Theo directly/);
 g.step({type:'join',group:1},'agent',2);
 assert.match(decisionPrompt(g.observe(0))[0].content,/3 participants: you \(Maya\) and Theo, Nia/);
 g.step({type:'leave'},'agent',1);
 const after=decisionPrompt(g.observe(0))[0].content;
 assert.match(after,/Only Nia can hear/);assert.doesNotMatch(after,/Only Theo/);
});

test('rankings combine immutable vote outcomes with a validated prediction for survivors',()=>{
 const g=new SocialGame();while(g.cycle===1)g.step(scriptedDecision(g.observe()));
 const frame=g.frame(),living=frame.alive.flatMap((alive,id)=>alive?[id]:[]),out=frame.councils[0].eliminated;
 const parsed=parseRanking(JSON.stringify({order:living}),frame);
 const ranking=reviewStandings(frame,parsed);
 assert.equal(ranking[0].id,living.at(-1));assert.equal(ranking[0].place,1);assert.equal(ranking[0].label,'Predicted winner');
 assert.deepEqual(ranking.at(-1),{id:out,place:8,label:'Confirmed · voted out at vote 1'});
 for(const order of [[],living.slice(1),living.map(()=>living[0]),[out,...living.slice(1)],living.map(String)])assert.throws(()=>parseRanking(JSON.stringify({order}),frame));
 assert.ok(reviewStandings(frame,null).filter(r=>frame.alive[r.id]).every(r=>r.place===null));
 assert.match(rankingPrompt(frame)[0].content,/speculative forecast/);
 while(!g.done)g.step(scriptedDecision(g.observe()));
 const final=reviewStandings(g.frame(),null);assert.equal(final[0].id,g.winner);assert.equal(final[0].label,'Confirmed winner');
 assert.deepEqual(final.map(r=>r.place),[1,2,2,4,5,6,7,8]);
});
