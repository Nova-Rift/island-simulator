import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { SocialDemo } from './SocialDemo'
import { LiveSurvival } from './LiveSurvival'
import { ServerLanguageModel } from './serverLanguage'
import './styles.css'
import './local.css'
const makeModel=()=>new ServerLanguageModel()
function App(){const [legacy,setLegacy]=useState(false);return <main className="local-shell"><header><p className="eyebrow">LOCAL RESEARCH WORKSPACE</p><h1>Social simulator</h1><p>Private conversations and a vote. Free scripted mode by default; enable local Runpod for agent choices.</p><button onClick={()=>setLegacy(!legacy)}>{legacy?'Back to social game':'Earlier island game'}</button></header>{legacy?<LiveSurvival/>:<SocialDemo makeModel={makeModel}/>}</main>}
createRoot(document.getElementById('root')!).render(<App/>)
