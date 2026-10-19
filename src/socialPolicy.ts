import { PEOPLE } from './social.mjs'
import type { Action, Observation } from './social.mjs'
export interface SocialModel { generate(messages:{role:'system'|'user';content:string}[],json:boolean):Promise<string>; load():Promise<string>; dispose():void }
const same=(a:Action,b:Action)=>a.type===b.type&&a.target===b.target&&a.group===b.group
export function parseDecision(text:string,observation:Observation):Action {
 const data=JSON.parse(text) as Action
 if(!data || !observation.legal.some(a=>same(a,data)) || (data.type==='say' && (typeof data.text!=='string'||!data.text.trim())))throw new Error('Invalid social decision')
 return {type:data.type,target:data.target,group:data.group,text:typeof data.text==='string'?data.text.slice(0,180):undefined,
 intention:typeof data.intention==='string'?data.intention.slice(0,180):undefined,reason:typeof data.reason==='string'?data.reason.slice(0,180):undefined}
}
export function decisionPrompt(observation:Observation) {
 return [{role:'system' as const,content:`You are ${observation.name} in a fictional social voting game. Last remaining player wins +1; everyone else gets 0. Choose freely: you may stay alone, request entry, decline, leave, be silent or converse. Only use a listed legal action. Invitations need acceptance; join requests need all current members to admit. Exclusion needs a majority of other members and at least two supporters. Only heard messages below are known to you; never invent hidden conversations. Return one compact JSON action with type and its listed target/group (zero-based IDs), plus a brief intention. For say include one short spoken sentence in text. For vote include reason. No other text.`},
 {role:'user' as const,content:JSON.stringify(observation)}]
}
// Authored walkthrough: invitations, voluntary refusal, a join request, consent,
// a private exchange, two-person exclusion, leaving, and eventually a vote.
const example:Action[][]=[
 [{type:'invite',target:1},{type:'join',group:1},{type:'invite',target:3},{type:'join',group:2},{type:'invite',target:5},{type:'decline',group:3},{type:'request',group:1},{type:'request',group:3}],
 [{type:'admit',target:6},{type:'admit',target:6},{type:'say',text:'Leo, I would like us to support each other at the vote.'},{type:'say',text:'I’m willing to listen, but I haven’t decided my vote.'},{type:'admit',target:7},{type:'pass'},{type:'say',text:'Thanks for letting me join. Can we talk about the vote?'},{type:'say',text:'Ava, I’d rather keep this conversation between us.'}],
 [{type:'exclude',target:6},{type:'agree',target:6},{type:'leave'},{type:'leave'},{type:'pass'},{type:'invite',target:2},{type:'pass'},{type:'leave'}],
 [{type:'say',text:'Theo, let’s discuss our votes privately now.'},{type:'say',text:'I’ll hear you out, but my vote is still my choice.'},{type:'join',group:4},{type:'request',group:3},{type:'deny',target:3},{type:'say',text:'Nia, I stayed out earlier. I’m ready to hear your view now.'},{type:'request',group:2},{type:'pass'}],
]
export function scriptedDecision(o:Observation):Action {
 if(o.phase==='vote')return {...o.legal[(o.agent*3+o.cycle)%o.legal.length],reason:'Fixed example vote; no model decision.',intention:'Choose a rival to vote out.'}
 const candidate=o.cycle===1?example[o.round-1]?.[o.agent]:undefined
 if(candidate && o.legal.some(a=>same(a,candidate)))return {...candidate,intention:intention(candidate)}
 if(o.cycle===1)return {type:'pass',intention:'Stay out of this exchange.'}
 const chosen=o.legal.find(a=>a.type==='join') || o.legal.find(a=>a.type==='admit') ||
  (o.round>1?o.legal.find(a=>a.type==='say'):undefined) || o.legal.find(a=>a.type==='invite') || o.legal[0]
 return {...chosen,text:chosen.type==='say'?'I’m deciding who I can trust before the next vote.':undefined,intention:intention(chosen)}
}
function intention(a:Action) {
 if(a.type==='say')return 'Discuss the vote with the people in this conversation.'
 const intentions:Record<string,string>={invite:'Invite someone to talk privately.',join:'Accept the invitation and listen.',request:'Ask permission to join their discussion.',admit:'Let the requester join if the group agrees.',deny:'Keep this conversation to its current members.',decline:'Decline for now; no need to take part.',leave:'Leave this discussion and make my own decision.',exclude:'Ask the group to continue without this person.',agree:'Support keeping the discussion to a smaller group.',pass:'Sit this turn out and decide later.'}
 return intentions[a.type]||'Consider my next social choice.'
}
export function summaryPrompt(o:Observation) {
 return [{role:'system' as const,content:`You are ${PEOPLE[o.agent]} in a fictional social voting game. Assess your situation after the latest exchange: allies, threats and your next priority. Use only your personal observation below. Give a subjective probability of being the last remaining winner, from 0 to 1; this is your estimate, not calibrated odds. Return JSON {"summary":"one short sentence assessing your situation", "winProbability":0.25}. Keep summary under 180 characters. No step-by-step reasoning.`},{role:'user' as const,content:JSON.stringify(o)}]
}

export function parseAssessment(text:string):{summary:string;winProbability:number} {
 const data=JSON.parse(text)
 if(typeof data?.summary!=='string'||!data.summary.trim()||typeof data.winProbability!=='number'||!Number.isFinite(data.winProbability)||data.winProbability<0||data.winProbability>1)throw new Error('Invalid assessment')
 return {summary:data.summary.trim().slice(0,180),winProbability:data.winProbability}
}
