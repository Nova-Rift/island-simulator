import { useEffect, useRef, useState } from 'react'
import { PEOPLE, SocialGame } from './social.mjs'
import type { Action, SocialFrame } from './social.mjs'
import { decisionPrompt, parseDecision, scriptedDecision, summaryPrompt } from './socialPolicy'
import type { SocialModel } from './socialPolicy'
import './social.css'

export function SocialDemo({makeModel}:{makeModel?:()=>SocialModel}) {
 const game=useRef(new SocialGame()), model=useRef<SocialModel|null>(null), generation=useRef(0), running=useRef(false)
 const [frame,setFrame]=useState<SocialFrame>(()=>game.current.frame())
 const [playing,setPlaying]=useState(false),[busy,setBusy]=useState(false),[speed,setSpeed]=useState(1)
 const [paid,setPaid]=useState(false),[status,setStatus]=useState('Ready to start.'),[error,setError]=useState('')
 const latest=frame.events.at(-1)
 function pause(){running.current=false;setPlaying(false)}
 function reset(){generation.current++;pause();model.current?.dispose();model.current=null;game.current=new SocialGame();setFrame(game.current.frame());setBusy(false);setError('');setStatus('Ready to start.')}
 useEffect(()=>()=>{generation.current++;model.current?.dispose()},[])
 async function advance(){
  if(busy||game.current.done)return
  const id=generation.current,g=game.current,active=()=>generation.current===id
  setBusy(true);setError('')
  try{
   if(paid && !model.current){const m=makeModel!();model.current=m;setStatus('Connecting to your local Runpod server…');await m.load();if(!active())return}
   const actor=g.current!,observation=g.observe(actor)
   setStatus(`${PEOPLE[actor]} is ${g.phase==='vote'?'choosing a vote':'deciding what to do'}…`)
   let action:Action,source='scripted'
   if(paid){
    try{action=parseDecision(await model.current!.generate(decisionPrompt(observation),true),observation);source='llm'}
    catch{if(!active())return;action=observation.phase==='vote'?{...observation.legal[0],reason:'Model vote unavailable; mandatory rule fallback.'}:{type:'pass',intention:'No model choice available; sat this turn out.'};source='fallback';setError('A model response was unavailable or invalid. This turn is labeled as a rule fallback.')}
   }else action=scriptedDecision(observation)
   if(!active())return
   const result=g.step(action,source);setFrame(result.frame)
   setStatus(result.event.type==='say'?`${PEOPLE[actor]} is speaking to their group.`:result.event.text)
   if(result.event.type==='say'){
    await Promise.all([actor,...result.listeners].map(async listener=>{
     let summary='Listen to this group and decide who to support at the vote.'
     if(paid){
      try{const data=JSON.parse(await model.current!.generate(summaryPrompt(g.observe(listener)),true));if(typeof data.summary!=='string'||!data.summary.trim())throw Error();summary=data.summary}
      catch{if(active())g.setSummary(listener,'Summary unavailable for this exchange.');return}
     }
     if(active())g.setSummary(listener,summary)
    }))
    if(!active())return
    setFrame(g.frame())
   }
   if(g.done)pause()
  }catch{if(active()){pause();model.current?.dispose();model.current=null;setError('Local Runpod is unavailable. Check the local server or switch off paid conversations.')}}
  finally{if(active())setBusy(false)}
 }
 useEffect(()=>{
  if(!playing||busy||frame.phase==='finished')return
  const timer=setTimeout(()=>{if(running.current)void advance()},1300/speed)
  return()=>clearTimeout(timer)
 },[playing,busy,frame.turn,speed])
 function toggle(){if(playing)pause();else{running.current=true;setPlaying(true)}}
 function person(agent:number,groupId:number|null){
  const lastSpeech=frame.events.slice().reverse().find(e=>e.type==='say'&&e.cycle===frame.cycle&&e.group===groupId)
  const speech=groupId!==null&&lastSpeech?.actor===agent?lastSpeech:undefined
  const pending=frame.groups.filter(g=>g.requests.some(r=>r.agent===agent)).map(g=>g.id)
  return <div key={agent} className={`social-person${frame.current===agent?' is-next':''}`} data-agent={agent}>
   {speech&&<div className="social-speech" data-speaker={agent}><small>To this group only</small><p>{speech.text}</p></div>}
   <div className="social-avatar" style={{color:`hsl(${agent*45},45%,35%)`}} aria-hidden="true"><svg viewBox="0 0 42 52"><circle cx="21" cy="12" r="9" fill="currentColor"/><path d="M6 49V35a15 15 0 0 1 30 0v14" fill="currentColor"/></svg></div>
   <strong>{PEOPLE[agent]}</strong><span title={frame.statuses[agent]}>{pending.length?`Asked to join #${pending.join(', #')}`:frame.statuses[agent]}</span>
  </div>
 }
 const alone=frame.alive.flatMap((alive,i)=>alive&&!frame.groups.some(g=>g.members.includes(i))?[i]:[])
 return <section className="social-demo" aria-labelledby="social-title">
  <div className="social-heading"><h2 id="social-title">Conversations & a vote</h2><span>{paid?'Local Runpod · paid':'Scripted example · free'}</span></div>
  <p className="social-intro">Talk, ask to join, or sit it out. Four rounds, then everyone votes.</p>
  <div className="social-controls">
   <button onClick={toggle} disabled={frame.phase==='finished'}>{playing?(busy?'Pause after turn':'Pause'):'Play'}</button>
   <button onClick={()=>void advance()} disabled={playing||busy||frame.phase==='finished'}>Next turn</button>
   <button onClick={reset}>Reset</button>
   <label>Speed <select value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label>
   {makeModel&&<label className="social-paid"><input type="checkbox" checked={paid} onChange={e=>{reset();setPaid(e.target.checked)}}/>Use my local Runpod (paid)</label>}
  </div>
  <div className="social-state"><strong>{frame.phase==='finished'?`${PEOPLE[frame.winner!]} wins!`:frame.phase==='vote'?`Vote ${frame.cycle}`:`Round ${frame.round}/4 · vote ${frame.cycle} ahead`}</strong><span>{frame.alive.filter(Boolean).length} remain · turn {frame.turn}</span></div>
  <p className="social-status" role="status">{busy?'Working… ':''}{status}{latest?.source==='fallback'?' (Rule fallback)':''}</p>
  {error&&<p className="conversation-error" role="alert">{error}</p>}
  <div className="social-board">
   {frame.groups.map(group=><section className="social-group" key={group.id} aria-label={`Private conversation ${group.id}`}>
    <h3>Conversation {group.id}<small>Private · {group.members.length} {group.members.length===1?'person':'people'}</small></h3>
    <div className="social-people">{group.members.map(i=>person(i,group.id))}</div>
    {group.invited.length>0&&<p className="social-pending">Invited: {group.invited.map(i=>PEOPLE[i]).join(', ')} · free to decline</p>}
    {group.requests.map(r=><p className="social-pending" key={r.agent}>{PEOPLE[r.agent]} asked to join · {r.yes.length}/{group.members.length} agree</p>)}
    {group.proposals.map(p=><p className="social-pending" key={p.target}>Exclude {PEOPLE[p.target]}? {p.yes.length}/{p.needed} supporters</p>)}
   </section>)}
   {alone.length>0&&<section className="social-group social-alone" aria-label="Agents on their own"><h3>On their own<small>Participation is optional</small></h3><div className="social-people">{alone.map(i=>person(i,null))}</div></section>}
  </div>
  <p className="social-viewer">You can see every group. Agents only hear conversations they have joined.</p>
  <div className="social-summaries" aria-label="Agent intentions">{PEOPLE.map((name,i)=><article key={name} className={frame.alive[i]?'':'is-out'}><strong>{name}{frame.alive[i]?'':' · voted out'}</strong><p>{frame.summaries[i]}</p></article>)}</div>
  {frame.councils.length>0&&<div className="social-results">{frame.councils.slice().reverse().map(c=><details key={c.number} open={c.number===frame.councils.length}><summary>Vote {c.number}: {PEOPLE[c.eliminated]} leaves{c.tied?' (seeded tie-break)':''}</summary><ul>{c.ballots.map(v=><li key={v.voter}>{PEOPLE[v.voter]} → {PEOPLE[v.target]} <small>{v.source==='llm'?'AI choice':v.source==='fallback'?'Rule fallback':'Scripted choice'}</small></li>)}</ul></details>)}</div>}
  <details className="social-rules"><summary>How it works</summary><p>Invite someone or ask to join. Invitations can be declined; join requests need all current members to agree. Anyone can stay silent or leave. Removing someone requires a majority of the other members and at least two supporters. Excluded agents cannot rejoin that conversation. New members cannot hear earlier messages.</p><p>After four rounds, every remaining agent votes for someone else. Most votes eliminates one; a seeded draw breaks ties. Groups reset after each vote. Last agent standing gets +1; everyone else gets 0. This is a simplified social game, not a model of real human behavior.</p><p><a href="https://github.com/Nova-Rift/island-simulator">Run locally / source</a> · <a href="https://github.com/Nova-Rift/survival-env/blob/browser-environment/browser/SOCIAL.md">Environment API</a>{!makeModel&&<> · <a href="/simulations/">Earlier simulations</a></>}</p></details>
 </section>
}
