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
test('shared deadlines still enforce mandatory voting and one winner',async()=>{
 const g=new SocialGame({concurrent:true,discussionSeconds:1});let runner,now=0;
 await new Promise((resolve,reject)=>{runner=new SocialRunner({game:g,now:()=>now,waitMs:0,onEvent:()=>{now+=250;runner.tick()},decide:async o=>o.phase==='vote'?o.legal[0]:{type:'pass'},onDone:resolve,onError:reject});runner.start()});
 assert.equal(g.councils.length,6);assert.ok(g.turn>=35);assert.equal(g.remaining.length,3);runner.stop();
});

test('waiting agents wake on invitations and their clock does not invalidate pending decisions',async()=>{
 const g=new SocialGame({concurrent:true});let now=0,finish;const seen=[];
 const runner=new SocialRunner({game:g,now:()=>now,decide:o=>{seen.push(o);return new Promise(r=>finish=r)}});
 runner.start(false);finish({type:'pass'});await tick();
 runner.start(false);assert.equal(seen.at(-1).agent,1); // waiting Maya is skipped
 runner.stop();
 g.step({type:'invite',target:0},'llm',2);
 const awake=new SocialRunner({game:g,now:()=>now,decide:o=>{seen.push(o);return new Promise(()=>{})}});
 awake.waiting.set(0,{until:5000,context:'old personal context'});
 const before=seen.length;awake.start();
 assert.ok(seen.slice(before).some(o=>o.agent===0&&o.invitations.length>0),'New invitation wakes waiting Maya before five seconds');
 awake.stop();
 const timed=new SocialGame({concurrent:true,discussionSeconds:2});
 const r=new SocialRunner({game:timed,now:()=>now,decide:o=>{seen.push(o);return new Promise(()=>{})}});
 r.start();now=1000;r.tick();assert.equal(timed.observe(0).voteClock.secondsRemaining,1);
 r.pause();now=10000;r.tick();assert.equal(timed.discussionRemainingMs,1000);r.stop();
});

test('deadline drains in-flight replies before voting, even when the clock changed',async()=>{
 const g=new SocialGame({concurrent:true,discussionSeconds:1});let now=0;
 const decisions=new Map();let releaseAssessment;
 g.step({type:'invite',target:1},'llm',0);g.step({type:'join',group:1},'llm',1);
 const r=new SocialRunner({game:g,now:()=>now,decide:o=>new Promise(resolve=>decisions.set(o.agent,resolve)),assess:()=>new Promise(resolve=>releaseAssessment=resolve)});
 r.start();now=1100;r.tick();r.pump();assert.equal(g.phase,'social');
 decisions.get(0)({type:'say',text:'A last word before voting.'});
 for(const [id,resolve] of decisions)if(id!==0)resolve({type:'pass'});
 await tick();assert.equal(g.events.filter(e=>e.type==='say').length,1);assert.equal(g.phase,'social');
 releaseAssessment();await tick();assert.equal(g.phase,'vote');r.stop();
});
