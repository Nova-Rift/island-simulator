import { createRoot } from 'react-dom/client'
import { LiveSurvival } from './LiveSurvival'
import './styles.css'
import './local.css'
createRoot(document.getElementById('root')!).render(<main className="local-shell">
  <header><p className="eyebrow">LOCAL RESEARCH WORKSPACE</p><h1>Island simulator</h1>
  <p>Only served on this computer. <strong>Play with conversations uses your paid Runpod key.</strong> Silent mode is free. Nothing runs until you press Play.</p>
  <p><a href="https://github.com/Nova-Rift/island-simulator">Source & setup</a> · <a href="https://clarkwhitehead.com">Free public example</a></p></header>
  <LiveSurvival />
</main>)
