import { useEffect, useRef, useState } from 'react'
import { PEOPLE, SocialGame } from './social.mjs'
import type { Action, SocialFrame, Event } from './social.mjs'
import { scriptedDecision, summaryPrompt, parseAssessment, DEFAULT_STARTING_PROMPT, gameReviewPrompt, chooseModelDecision } from './socialPolicy'
import type { SocialModel } from './socialPolicy'
import './social.css'

type Assessment={summary:string;winProbability:number|null;turn:number;cycle:number;group:number|null;source:string}

export function SocialDemo({makeModel}:{makeModel?:()=>SocialModel}) {
 const game=useRef(new SocialGame()), model=useRef<SocialModel|null>(null), generation=useRef(0), running=useRef(false)
 const [frame,setFrame]=useState<SocialFrame>(()=>game.current.frame())
 const [playing,setPlaying]=useState(false),[busy,setBusy]=useState(false),[speed,setSpeed]=useState(1)
 const [paid,setPaid]=useState(false),[status,setStatus]=useState('Ready to start.'),[error,setError]=useState('')
 const [assessments,setAssessments]=useState<Record<number,Assessment>>({})
 const [historyGroup,setHistoryGroup]=useState('all'),[historyAgent,setHistoryAgent]=useState('all')
 const [startingPrompt,setStartingPrompt]=useState(DEFAULT_STARTING_PROMPT)
 const [reviews,setReviews]=useState<Record<number,string>>({}),[reviewErrors,setReviewErrors]=useState<Record<number,string>>({}),[reviewing,setReviewing]=useState(false)
 const reviewBusy=useRef(false)
 const [waitingSeconds,setWaitingSeconds]=useState(0)
 useEffect(()=>{if(!busy&&!reviewing){setWaitingSeconds(0);return}const start=Date.now();const timer=setInterval(()=>setWaitingSeconds(Math.floor((Date.now()-start)/1000)),1000);return()=>clearInterval(timer)},[busy,reviewing])
 const latest=frame.events.at(-1)
 const conversations=Array.from(new Set(frame.events.filter(e=>e.group!==null).map(e=>`${e.cycle}:${e.group}`)))
 const history=frame.events.filter(e=>e.group!==null && (historyGroup==='all'||`${e.cycle}:${e.group}`===historyGroup) && (historyAgent==='all'||e.audience.includes(Number(historyAgent))))
 function pause(){running.current=false;setPlaying(false)}
 function stopWaiting(){generation.current++;pause();model.current?.dispose();model.current=null;setBusy(false);setReviewing(false);reviewBusy.current=false;setStatus('Stopped waiting. Current game state kept.');setError('')}
 function reset(){generation.current++;pause();model.current?.dispose();model.current=null;game.current=new SocialGame();setFrame(game.current.frame());setBusy(false);setError('');setStatus('Ready to start.');setAssessments({});setHistoryGroup('all');setHistoryAgent('all');setReviews({});setReviewErrors({});setReviewing(false);reviewBusy.current=false}
 useEffect(()=>()=>{generation.current++;model.current?.dispose()},[])
 async function reviewGame(finalFrame:SocialFrame){
  if(!makeModel||finalFrame.phase!=='finished'||reviewBusy.current)return
  const id=generation.current,active=()=>generation.current===id
  reviewBusy.current=true;setReviewing(true);setReviewErrors({})
  try{
   if(!model.current){model.current=makeModel();await model.current.load()}
   if(!active())return
   const reviewer=model.current
   for(let agent=0;agent<PEOPLE.length;agent++){
    if(!active())return
    if(reviews[agent])continue
    try{
     const data=JSON.parse(await reviewer.generate(gameReviewPrompt(finalFrame,agent),true))
     if(typeof data.summary!=='string'||!data.summary.trim())throw new Error('Invalid recap')
     if(active())setReviews(previous=>({...previous,[agent]:data.summary.trim().slice(0,500)}))
    }catch(e){if(active())setReviewErrors(previous=>({...previous,[agent]:(e as {code?:string})?.code==='CONTEXT_LIMIT'?'Full game record could not fit; no history was trimmed.':'Review unavailable. You can retry.'}))}
   }
  }catch{if(active())setReviewErrors({0:'Could not connect to the local model. You can retry.'})}
  finally{if(active()){reviewBusy.current=false;setReviewing(false)}}
 }
 async function advance(){
  if(busy||game.current.done||!startingPrompt.trim())return
  const id=generation.current,g=game.current,active=()=>generation.current===id
  setBusy(true);setError('')
  try{
   if(paid && !model.current){const m=makeModel!();model.current=m;setStatus('Connecting to your local Runpod server…');await m.load();if(!active())return}
   const actor=g.current!,observation=g.observe(actor)
   setStatus(`${PEOPLE[actor]} is ${g.phase==='vote'?'choosing a vote':'deciding what to do'}…`)
   let action:Action,source='scripted'
   if(paid){
    try{action=await chooseModelDecision(model.current!,observation,startingPrompt);source='llm'}
    catch(e){if(!active())return;throw Object.assign(e instanceof Error?e:new Error('Invalid decision'),{code:(e as {code?:string})?.code||'INVALID_ACTION'})}
   }else action=scriptedDecision(observation)
   if(!active())return
   const result=g.step(action,source);setFrame(result.frame)
   setStatus(result.event.type==='say'?`${PEOPLE[actor]} is speaking to their group.`:result.event.text)
   if(result.event.type==='say'){
    await Promise.all([actor,...result.listeners].map(async listener=>{
     let assessment:Assessment={summary:'I am discussing the vote with this group; their support is not guaranteed.',winProbability:null,turn:result.event.turn,cycle:result.event.cycle,group:result.event.group,source:paid?'AI self-assessment':'Scripted example'}
     if(paid){
      try{assessment={...assessment,...parseAssessment(await model.current!.generate(summaryPrompt(g.observe(listener)),true))}}
      catch(e){if((e as {code?:string})?.code)throw e;assessment={...assessment,summary:'Assessment unavailable for this exchange.',source:'Unavailable'}}
     }
     if(active()){
      g.setSummary(listener,assessment.summary)
      setAssessments(previous=>({...previous,[listener]:assessment}))
     }
    }))
    if(!active())return
    setFrame(g.frame())
   }
   if(g.done){pause();if(paid)await reviewGame(g.frame())}
  }catch(e){if(active()){pause();model.current?.dispose();model.current=null;setError((e as {code?:string})?.code==='INVALID_ACTION'?`Paused: ${e instanceof Error?e.message:'Invalid decision.'} No rule fallback was used.`:modelFailureMessage((e as {code?:string})?.code))}}
  finally{if(active())setBusy(false)}
 }
 useEffect(()=>{
  if(!playing||busy||frame.phase==='finished')return
  const timer=setTimeout(()=>{if(running.current)void advance()},1300/speed)
  return()=>clearTimeout(timer)
 },[playing,busy,frame.turn,speed])
 function toggle(){if(playing)pause();else{running.current=true;setPlaying(true)}}
 function person(agent:number){
  const pending=frame.groups.filter(g=>g.requests.some(r=>r.agent===agent)).map(g=>g.id)
  return <div key={agent} className={`social-person${frame.current===agent?' is-next':''}`} data-agent={agent}>
   <div className="social-avatar" style={{color:`hsl(${agent*45},45%,35%)`}} aria-hidden="true"><svg viewBox="0 0 42 52"><circle cx="21" cy="12" r="9" fill="currentColor"/><path d="M6 49V35a15 15 0 0 1 30 0v14" fill="currentColor"/></svg></div>
   <strong>{PEOPLE[agent]}</strong><span title={frame.statuses[agent]}>{pending.length?`Asked to join #${pending.join(', #')}`:frame.statuses[agent]}</span>
  </div>
 }
 const alone=frame.alive.flatMap((alive,i)=>alive&&!frame.groups.some(g=>g.members.includes(i))?[i]:[])
 return <section className="social-demo" aria-labelledby="social-title">
  <div className="social-heading"><h2 id="social-title">Conversations & a vote</h2><span>{paid?'Local Runpod · paid':'Scripted example · free'}</span></div>
  <p className="social-intro">Talk, ask to join, or sit it out. Four rounds, then everyone votes.</p>
  <details className="social-prompt">
   <summary>Starting prompt · editable</summary>
   <label htmlFor="agent-starting-prompt">Instructions shared by all live agents</label>
   <textarea id="agent-starting-prompt" value={startingPrompt} disabled={busy||playing} onChange={e=>setStartingPrompt(e.target.value)} spellCheck={false}/>
   <p>Use {'{name}'} for each agent’s name. Changes apply to subsequent live decisions; reset the game to start everyone with the new prompt. Scripted mode does not use it.</p>
   <p>Each decision also includes that agent’s game state, legal actions and full personal history. A fixed output-format instruction asks the model to choose a numbered legal action. Post-conversation assessments use a separate prompt.</p>
   <button type="button" disabled={busy||playing} onClick={()=>setStartingPrompt(DEFAULT_STARTING_PROMPT)}>Restore default prompt</button>
   {(busy||playing)&&<p>Pause to edit the prompt.</p>}
   {!startingPrompt.trim()&&<p role="alert">Enter a prompt before starting.</p>}
  </details>
  <div className="social-controls">
   <button onClick={toggle} disabled={frame.phase==='finished'||!startingPrompt.trim()}>{playing?(busy?'Pause after turn':'Pause'):'Play'}</button>
   <button onClick={()=>void advance()} disabled={playing||busy||frame.phase==='finished'||!startingPrompt.trim()}>Next turn</button>
   <button onClick={reset}>Reset</button>
   {(busy||reviewing)&&<button onClick={stopWaiting}>Stop waiting</button>}
   <label title="Only changes the pause between turns; does not speed up Runpod inference.">Turn speed <select value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label>
   {makeModel&&<label className="social-paid"><input type="checkbox" checked={paid} onChange={e=>{reset();setPaid(e.target.checked)}}/>Use my local Runpod (paid)</label>}
  </div>
  <div className="social-state"><strong>{frame.phase==='finished'?`${PEOPLE[frame.winner!]} wins!`:frame.phase==='vote'?`Vote ${frame.cycle}`:`Round ${frame.round}/4 · vote ${frame.cycle} ahead`}</strong><span>{frame.alive.filter(Boolean).length} remain · turn {frame.turn}</span></div>
  <p className="social-status" role="status">{busy?`Waiting on ${paid?'Runpod':'simulation'} · ${waitingSeconds}s — `:''}{status}{latest?.source==='fallback'?' (Rule fallback)':''}</p>
  {error&&<p className="conversation-error" role="alert">{error}</p>}
  <div className="social-board">
   {frame.groups.map(group=><section className="social-group" key={group.id} aria-label={`Private conversation ${group.id}`}>
    <h3>Conversation {group.id}<small>Private · {group.members.length} {group.members.length===1?'person':'people'}</small></h3>
    <div className="social-people">{group.members.map(i=>person(i))}</div>
    <ConversationChat events={frame.events.filter(e=>e.cycle===frame.cycle&&e.group===group.id)} group={group.id}/>
    {group.invited.length>0&&<p className="social-pending">Invited: {group.invited.map(i=>PEOPLE[i]).join(', ')} · free to decline</p>}
    {group.requests.map(r=><p className="social-pending" key={r.agent}>{PEOPLE[r.agent]} asked to join · {r.yes.length}/{group.members.length} agree</p>)}
    {group.proposals.map(p=><p className="social-pending" key={p.target}>Exclude {PEOPLE[p.target]}? {p.yes.length}/{p.needed} supporters</p>)}
   </section>)}
   {alone.length>0&&<section className="social-group social-alone" aria-label="Agents on their own"><h3>On their own<small>Participation is optional</small></h3><div className="social-people">{alone.map(i=>person(i))}</div></section>}
  </div>
  {frame.pendingConversations.some(g=>g.invited.length||g.requests.length)&&<div className="social-pending-invitations" aria-label="Pending invitations">
   <strong>Pending invitations</strong>
   {frame.pendingConversations.map(group=><div key={group.id}>
    {group.invited.length>0&&<p>{PEOPLE[group.members[0]]} invited {group.invited.map(id=>PEOPLE[id]).join(', ')} · waiting for acceptance</p>}
    {group.requests.map(r=><p key={r.agent}>{PEOPLE[r.agent]} asked to talk with {PEOPLE[group.members[0]]} · waiting for acceptance</p>)}
   </div>)}
  </div>}
  <p className="social-viewer">A conversation starts when someone accepts. You can see every group. Agents only hear conversations they have joined.</p>
  <div className="social-summaries" aria-label="Latest conversation assessments">{PEOPLE.map((name,i)=>{
   const assessment=assessments[i]
   return <article key={name} className={frame.alive[i]?'':'is-out'}><strong>{name}{frame.alive[i]?'':' · voted out'}</strong>
    <p>{assessment?.summary||'No conversation assessment yet.'}</p>
    <p className="social-odds">{frame.phase==='finished'&&frame.winner===i?'Winner':!frame.alive[i]?'Eliminated · winning chance 0%':assessment?.winProbability!=null?`Own estimate of winning: ${Math.round(assessment.winProbability*100)}%`:'Winning estimate: unavailable'}</p>
    {assessment&&<small>{assessment.source} · vote {assessment.cycle}, turn {assessment.turn} · conversation {assessment.group}</small>}
   </article>
  })}</div>
  <p className="social-viewer">Assessments update for everyone who hears an exchange. AI estimates are subjective, not measured odds.</p>
  <details className="social-history" open><summary>Conversation history · {frame.events.filter(e=>e.type==='say').length} messages</summary>
   <div className="social-controls">
    <label>Conversation <select value={historyGroup} onChange={e=>setHistoryGroup(e.target.value)}><option value="all">All conversations</option>{conversations.map(key=><option key={key} value={key}>Vote {key.split(':')[0]} · conversation {key.split(':')[1]}</option>)}</select></label>
    <label>Heard by <select value={historyAgent} onChange={e=>setHistoryAgent(e.target.value)}><option value="all">Everyone (viewer)</option>{PEOPLE.map((name,i)=><option key={name} value={i}>{name}</option>)}</select></label>
   </div>
   <div className="social-transcript" role="region" aria-label="Conversation transcript" tabIndex={0}>
    {history.length===0?<p>No conversation activity yet.</p>:history.map(e=><article key={e.turn} className={e.type==='say'?'is-speech':''}><small>Vote {e.cycle} · round {e.round} · turn {e.turn} · conversation {e.group}</small><p>{e.type==='say'&&<strong>{PEOPLE[e.actor]}: </strong>}{e.text}</p>{e.type==='say'&&<small>Heard by {e.audience.map(i=>PEOPLE[i]).join(', ')}</small>}</article>)}
   </div>
   <p className="social-viewer">Earlier conversations stay here across votes, even after a group closes. Reset or reload clears this game.</p>
  </details>
  {frame.councils.length>0&&<div className="social-results">{frame.councils.slice().reverse().map(c=><details key={c.number} open={c.number===frame.councils.length}><summary>Vote {c.number}: {PEOPLE[c.eliminated]} leaves{c.tied?' (seeded tie-break)':''}</summary><ul>{c.ballots.map(v=><li key={v.voter}>{PEOPLE[v.voter]} → {PEOPLE[v.target]} <small>{v.source==='llm'?'AI choice':v.source==='fallback'?'Rule fallback':'Scripted choice'}</small></li>)}</ul></details>)}</div>}
  {frame.phase==='finished'&&<section className="social-review" aria-labelledby="game-review-title">
   <h3 id="game-review-title">Game recap</h3>
   <p>An outside observer reviews the full transcript and votes. Explanations of motives are interpretations.</p>
   {reviewing&&<p role="status">Reviewing each player’s game… {waitingSeconds}s elapsed</p>}
   <div className="social-summaries">{PEOPLE.map((name,i)=><article key={name}><strong>{name}{frame.winner===i?' · winner':''}</strong><p>{reviews[i]||reviewErrors[i]||(reviewing?'Waiting for review…':'Not reviewed yet.')}</p></article>)}</div>
   {makeModel&&!reviewing&&Object.keys(reviews).length<PEOPLE.length&&<button onClick={()=>void reviewGame(frame)}>{Object.keys(reviewErrors).length?'Retry missing reviews (paid)':'Generate AI recap (paid)'}</button>}
  </section>}
  <details className="social-rules"><summary>How it works</summary><p>Invite someone or ask to join. Invitations can be declined; join requests need all current members to agree. Anyone can stay silent or leave. Removing someone requires a majority of the other members and at least two supporters. Excluded agents cannot rejoin that conversation. New members cannot hear earlier messages.</p><p>After four rounds, every remaining agent votes for someone else. Most votes eliminates one; a seeded draw breaks ties. Groups reset after each vote. Last agent standing gets +1; everyone else gets 0. This is a simplified social game, not a model of real human behavior.</p><p><a href="https://github.com/Nova-Rift/island-simulator">Run locally / source</a> · <a href="https://github.com/Nova-Rift/survival-env/blob/browser-environment/browser/SOCIAL.md">Environment API</a>{!makeModel&&<> · <a href="/simulations/">Earlier simulations</a></>}</p></details>
 </section>
}

function ConversationChat({events,group}:{events:Event[];group:number}) {
 const box=useRef<HTMLDivElement>(null),following=useRef(true)
 const [unread,setUnread]=useState(false)
 const lastTurn=events.at(-1)?.turn
 function bottom(){if(box.current)box.current.scrollTop=box.current.scrollHeight;following.current=true;setUnread(false)}
 useEffect(()=>{if(following.current)bottom();else setUnread(true)},[lastTurn])
 return <div className="social-chat-wrap">
  <div className="social-chat" ref={box} role="log" aria-label={`Messages in conversation ${group}`} aria-live="polite" aria-relevant="additions" tabIndex={0} onScroll={()=>{
   const el=box.current!;following.current=el.scrollHeight-el.scrollTop-el.clientHeight<32;if(following.current)setUnread(false)
  }}>
   {events.map(e=>e.type==='say'?<article className="social-chat-message" key={e.turn} data-speaker={e.actor}>
    <header><strong>{PEOPLE[e.actor]}</strong><small>Round {e.round} · turn {e.turn}</small></header><p>{e.text}</p>
   </article>:<p className="social-chat-event" key={e.turn}>{e.text}</p>)}
   {!events.some(e=>e.type==='say')&&<p className="social-chat-event">Waiting for the first message…</p>}
  </div>
  {unread&&<button className="social-chat-new" onClick={bottom}>New activity ↓</button>}
 </div>
}

function modelFailureMessage(code?:string){
 const messages:Record<string,string>={
  BUDGET_LIMIT:'Paused: the local conservative reservation limit is reached. No rule fallback was used. More paid requests require an explicitly increased allowance.',
  RATE_LIMIT:'Paused: too many requests this minute. Wait, then press Play to retry this turn.',
  CONTEXT_LIMIT:'Full personal history could not be accepted. Paused without removing memories. A larger-context model is needed to continue if the model limit was reached.',
  INVALID_ACTION:'Paused: the model chose an illegal action or returned an invalid decision. No rule fallback was used.',
  INVALID_JSON:'Paused: the model returned invalid JSON. No rule fallback was used.',
  INCOMPLETE_RESPONSE:'Paused: the model response was cut off or incomplete. No rule fallback was used.',
  EMPTY_RESPONSE:'Paused: the model returned an empty response. No rule fallback was used.',
  INVALID_REQUEST:'Paused: the local server rejected the request format. No rule fallback was used.'
 }
 return messages[code||'']||'Paused: the local model request failed. Check the local server and Runpod connection. No rule fallback was used.'
}
