import test from 'node:test';
import assert from 'node:assert/strict';
import {councilPrompt,parseBallot,generateCouncil,cleanSpeech} from '../src/islandLanguage.ts';
import {IslandGame} from '../src/simulation/island-game.mjs';
function gameAtCouncil() { const game=new IslandGame({councilEvery:1,config:{hazard_count:0}});game.play();game.advance();return game; }
test('council prompt limits private state and requires winner-only reward and non-self voting',()=>{
 const g=gameAtCouncil(), prompt=councilPrompt(g.frame(),g.world.config,0,[],true), text=JSON.stringify(prompt);
 assert.match(text,/winner reward \+1/); assert.match(text,/No self-votes/);
 assert.doesNotMatch(text,/hazardCells|positions|resources/);
 assert.throws(()=>parseBallot('{"target":1,"reason":"self"}',0,g.frame()));
 assert.throws(()=>parseBallot('{"target":99,"reason":"absent"}',0,g.frame()));
 assert.equal(parseBallot('{"target":2,"reason":"competition"}',0,g.frame()).target,1);
});
test('dialogue reaches subsequent speakers; invalid votes become explicitly labeled rule votes',async()=>{
 const g=gameAtCouncil(), messages=[], requests=[];
 const model={generate:async(prompt,json)=>{requests.push(prompt);return json?'invalid JSON':'Maya, can we work together?';}};
 const votes=await generateCouncil(model,g.frame(),g.world.config,[],g.ruleBallots(),()=>true,m=>messages.push(m));
 assert.equal(messages.length,8);assert.match(requests.find(p=>p[0].content.startsWith('You are Theo, player'))[1].content,/Maya: Maya, can we work together/);
 assert.equal(votes.length,8);assert.ok(votes.every(v=>v.source==='rule'));
 g.resolveCouncil(votes);assert.equal(g.remaining.length,7);
});
test('reset/cancellation discards pending generation before it can publish messages or votes',async()=>{
 const g=gameAtCouncil();let active=true;
 const model={generate:async()=>{active=false;return 'A stale message';}};
 const messages=[];
 await assert.rejects(generateCouncil(model,g.frame(),g.world.config,[],g.ruleBallots(),()=>active,m=>messages.push(m)),/cancelled/);
 assert.deepEqual(messages,[]);assert.equal(g.phase,'council');
});

test('both participants refresh their own summary after each exchange, and votes use the latest stance',async()=>{
 const g=gameAtCouncil(), updates=[], messages=[], requests=[];
 const model={generate:async(prompt,json)=>{requests.push(prompt);if(!json)return 'Theo, let us compare plans.';
  if(prompt[0].content.includes('public game status card'))return JSON.stringify({summary:'I want to compare plans before choosing a vote.'});
  return 'invalid vote';
 }};
 await generateCouncil(model,g.frame(),g.world.config,[],g.ruleBallots(),()=>true,m=>messages.push(m),(agent,state)=>updates.push({agent,state,after:messages.length}));
 assert.equal(updates.length,16);assert.deepEqual(updates.slice(0,2).map(u=>u.agent),[0,1]);
 assert.ok(updates.every(u=>u.state.status==='ready'&&u.after>=1));
 assert.equal(updates[0].state.partner,1);assert.equal(updates[1].state.partner,0);
 assert.match(requests.find(p=>p[0].content.includes('Cast one mandatory vote'))[1].content,/Your current stance: I want to compare plans/);
});

test('model speaker labels and trailing commentary do not appear as dialogue', () => {
 assert.equal(cleanSpeech('**Maya:** "Can we share food?"\n\n---\nExplanation.', 0), 'Can we share food?');
 assert.equal(cleanSpeech('Theo, can we agree on a vote?', 0), 'Theo, can we agree on a vote?');
});
test('independent summaries and votes overlap while exchanges retain their order',async()=>{
 const g=gameAtCouncil();let inFlight=0,peak=0,speeches=0,summaries=0;
 const model={generate:async(prompt,json)=>{
  inFlight++;peak=Math.max(peak,inFlight);
  if(!json){assert.equal(summaries,speeches*2);speeches++;}
  await new Promise(resolve=>setTimeout(resolve,2));inFlight--;
  if(prompt[0].content.includes('public game status card')){summaries++;return '{"summary":"I will listen before voting."}';}
  return json?'invalid vote':'Let us share fruit.';
 }};
 await generateCouncil(model,g.frame(),g.world.config,[],g.ruleBallots(),()=>true,()=>{});
 assert.equal(speeches,8);assert.equal(summaries,16);assert.equal(peak,4);
});
