import { useEffect, useState } from 'react'
const agents=Array.from({length:10},(_,id)=>({id,x:18+(id%5)*16,y:34+Math.floor(id/5)*32}))

// Ten stationary agents and one keyboard-controlled player. No network requests.
export function BlankSimulation(){
 const [player,setPlayer]=useState({x:500,y:390})
 useEffect(()=>{
  const held=new Set<string>()
  let frame=0,last=0
  const clear=()=>{held.clear();cancelAnimationFrame(frame);frame=0;last=0}
  const tick=(now:number)=>{
   const dt=last?Math.min((now-last)/1000,0.05):0;last=now
   const dx=Number(held.has('ArrowRight'))-Number(held.has('ArrowLeft'))
   const dy=Number(held.has('ArrowDown'))-Number(held.has('ArrowUp'))
   const distance=220*dt/(Math.hypot(dx,dy)||1)
   if(dx||dy)setPlayer(p=>({x:Math.max(22,Math.min(978,p.x+dx*distance)),y:Math.max(22,Math.min(418,p.y+dy*distance))}))
   frame=requestAnimationFrame(tick)
  }
  const down=(e:KeyboardEvent)=>{
   if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)||e.altKey||e.ctrlKey||e.metaKey)return
   const target=e.target as HTMLElement|null
   if(target?.closest('input,textarea,select,[contenteditable="true"]'))return
   e.preventDefault();held.add(e.key)
   if(!frame)frame=requestAnimationFrame(tick)
  }
  const up=(e:KeyboardEvent)=>{held.delete(e.key);if(!held.size)clear()}
  window.addEventListener('keydown',down);window.addEventListener('keyup',up)
  window.addEventListener('blur',clear);document.addEventListener('visibilitychange',clear)
  return()=>{clear();window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',clear);document.removeEventListener('visibilitychange',clear)}
 },[])

 return <section className="blank-simulation" aria-label="Environment with ten agents and a keyboard-controlled player">
  <div className="blank-toolbar"><span>10 agents + you · Arrow keys to move</span><span>Local · no API calls</span></div>
  <svg className="blank-world" viewBox="0 0 1000 460" tabIndex={0} role="img" aria-label="Ten stationary agents and your player. Use arrow keys to move." onClick={e=>e.currentTarget.focus()}>
   <rect width="1000" height="460" rx="12" fill="#e9eee7"/>
   {agents.map(agent=><g key={agent.id} transform={`translate(${agent.x*10} ${agent.y*4.6})`}>
    <title>Agent {agent.id+1}</title>
    <circle r="17" fill={`hsl(${agent.id*36} 40% 45%)`} stroke="#fff" strokeWidth="3"/>
    <text y="37" textAnchor="middle" fill="#34443d" fontSize="14">{agent.id+1}</text>
   </g>)}
   <g data-player="true" transform={`translate(${player.x} ${player.y})`}>
    <title>You · Arrow keys to move</title>
    <circle r="20" fill="#223c50" stroke="#fff" strokeWidth="4"/>
    <path d="M0 -10 L7 5 H-7 Z" fill="#fff"/>
    <text y="37" textAnchor="middle" fill="#223c50" fontSize="14" fontWeight="bold">You</text>
   </g>
  </svg>
 </section>
}
