import test from 'node:test';import assert from 'node:assert/strict';
import {placeSpeechBubbles} from '../src/speechLayout.ts';
const messages=Array.from({length:8},(_,speaker)=>({speaker,text:'We should discuss the vote.',council:1}));
test('speech bubbles never overlap or leave the map, even when speakers cluster at an edge',()=>{
 for(const [width,height] of [[280,220],[360,250],[740,300],[1024,360]])for(const positions of [Array(8).fill([0,0]),Array(8).fill([15,15]),Array(8).fill([8,8]),Array.from({length:8},(_,i)=>[i*2,i*2])]){
  const bubbles=placeSpeechBubbles(messages,positions,16,width,height);assert.ok(bubbles.length>=1&&bubbles.length<=3);assert.equal(bubbles[0].message.speaker,7);
  for(const [i,b] of bubbles.entries()){assert.ok(b.x>=0&&b.y>=0&&b.x+b.width<=width&&b.y+b.height<=height);
   for(const p of bubbles.slice(i+1))assert.ok(b.x+b.width<=p.x||p.x+p.width<=b.x||b.y+b.height<=p.y||p.y+p.height<=b.y);}
 }
});
test('only the latest message from each speaker is shown; hidden viewports have no bubbles',()=>{
 const repeated=[...messages,{speaker:7,text:'Newest',council:2}];
 const result=placeSpeechBubbles(repeated,Array(8).fill([8,8]),16,1024,360);
 assert.equal(result[0].message.text,'Newest');assert.equal(new Set(result.map(p=>p.message.speaker)).size,result.length);
 assert.deepEqual(placeSpeechBubbles(messages,Array(8).fill([8,8]),16,0,0),[]);
});
