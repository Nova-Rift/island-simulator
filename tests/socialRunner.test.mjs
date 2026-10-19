import test from 'node:test';import assert from 'node:assert/strict';
import {SocialGame} from '../src/social.mjs';import {SocialRunner} from '../src/socialRunner.mjs';
const tick=()=>new Promise(r=>setTimeout(r,10));
test('unrelated conversations and solo invitations progress while a group is slow; own chat waits for assessments',async()=>{
 const g=new SocialGame({concurrent:true});
 g.step({type:'invite',target:1},'llm',0);g.step({type:'join',group:1},'llm',1);
 g.step({type:'invite',target:3},'llm',2);g.step({type:'join',group:2},'llm',3);
 const started=[],resolve=new Map();let releaseAssessment;
 const runner=new SocialRunner({game:g,decide:o=>{started.push(o);return new Promise(r=>resolve.set(o.agent,r))},assess:()=>new Promise(r=>releaseAssessment=r)});
 runner.start();assert.deepEqual(started.map(o=>o.agent).sort(),[0,2,4,5,6,7]);
 resolve.get(2)({type:'say',text:'PRIVATE_GROUP_2'});await tick();
 assert.ok(!started.some(o=>o.agent===3));
 resolve.get(4)({type:'invite',target:5});await tick();
 assert.ok(g.events.some(e=>e.actor===4&&e.type==='invite'));assert.equal(g.actionCounts[0],1);
 releaseAssessment();await tick();
 const next=started.find(o=>o.agent===3);assert.ok(next.heard.some(e=>e.text.includes('PRIVATE_GROUP_2')));
 assert.ok(!started.find(o=>o.agent===0).heard.some(e=>e.text.includes('PRIVATE_GROUP_2')));
 runner.stop();
});
test('new personal notifications invalidate only the affected pending decision',async()=>{
 const g=new SocialGame({concurrent:true});let finish;
 const runner=new SocialRunner({game:g,decide:()=>new Promise(r=>finish=r)});runner.start(false);
 g.step({type:'invite',target:0},'llm',1);finish({type:'invite',target:2});await tick();
 assert.equal(g.turn,1);assert.equal(g.actionCounts[0],0);runner.stop();
});
test('independent actions still enforce quotas, mandatory voting and one winner',async()=>{
 const g=new SocialGame({concurrent:true});let runner;
 await new Promise((resolve,reject)=>{runner=new SocialRunner({game:g,decide:async o=>o.phase==='vote'?o.legal[0]:{type:'pass'},onDone:resolve,onError:reject});runner.start()});
 assert.equal(g.councils.length,7);assert.equal(g.turn,175);assert.equal(g.remaining.length,1);runner.stop();
});
