const agents=Array.from({length:10},(_,id)=>({id,x:18+(id%5)*16,y:34+Math.floor(id/5)*32}))

// Static starting world. No policies, language models, timers, or network requests.
export function BlankSimulation(){
 return <section className="blank-simulation" aria-label="Blank environment with ten agents">
  <div className="blank-toolbar"><span>10 agents</span><span>Local · no API calls</span></div>
  <svg className="blank-world" viewBox="0 0 1000 460" role="img" aria-label="Ten stationary agents in an empty environment">
   <rect width="1000" height="460" rx="12" fill="#e9eee7"/>
   {agents.map(agent=><g key={agent.id} transform={`translate(${agent.x*10} ${agent.y*4.6})`}>
    <title>Agent {agent.id+1}</title>
    <circle r="17" fill={`hsl(${agent.id*36} 40% 45%)`} stroke="#fff" strokeWidth="3"/>
    <text y="37" textAnchor="middle" fill="#34443d" fontSize="14">{agent.id+1}</text>
   </g>)}
  </svg>
 </section>
}
