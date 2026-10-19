import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { SocialDemo } from './SocialDemo'
import { LiveSurvival } from './LiveSurvival'
import { BlankSimulation } from './BlankSimulation'
import './styles.css'
import './local.css'
function App(){
 const [simulation,setSimulation]=useState('blank')
 return <main className="local-shell">
  <header><h1>Agent sandbox</h1>
   <label>Environment <select value={simulation} onChange={e=>setSimulation(e.target.value)}>
    <option value="blank">Blank · 10 agents</option>
    <option value="social">Archive · social game (scripted)</option>
    <option value="island">Archive · island simulation</option>
   </select></label>
  </header>
  {simulation==='blank'?<BlankSimulation/>:simulation==='social'?<SocialDemo/>:<LiveSurvival/>}
 </main>
}
createRoot(document.getElementById('root')!).render(<App/>)
