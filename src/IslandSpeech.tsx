import { useEffect, useRef, useState } from 'react'
import { castaways } from './islandPresentation'
import { placeSpeechBubbles } from './speechLayout'
import type { SpeechItem } from './speechLayout'
export function IslandSpeech({messages, positions, size}: {messages:SpeechItem[]; positions:number[][]; size:number}) {
  const root = useRef<HTMLDivElement>(null)
  const [bounds, setBounds] = useState({width:0,height:0})
  useEffect(() => {
    if (!root.current) return
    const observer = new ResizeObserver(([entry]) => setBounds({width:entry.contentRect.width,height:entry.contentRect.height}))
    observer.observe(root.current)
    return () => observer.disconnect()
  }, [])
  const placements = placeSpeechBubbles(messages, positions, size, bounds.width, bounds.height)
  return <div ref={root} className="island-speech-layer" aria-label="Castaways talking on the island">
    <svg className="speech-connectors" width="100%" height="100%" aria-hidden="true">
      {placements.map(p => <g key={p.message.speaker} stroke={`hsl(${p.message.speaker*45},65%,35%)`} strokeWidth="2.5"><line x1={p.anchorX} y1={p.anchorY} x2={Math.max(p.x,Math.min(p.x+p.width,p.anchorX))} y2={Math.max(p.y,Math.min(p.y+p.height,p.anchorY))}/><circle cx={p.anchorX} cy={p.anchorY} r="4" fill="white"/></g>)}
    </svg>
    {placements.map(p => <article key={p.message.speaker} className="island-speech-bubble" style={{left:p.x,top:p.y,width:p.width,height:p.height,borderColor:`hsl(${p.message.speaker*45},65%,35%)`}}>
      <strong>#{p.message.speaker+1} {castaways[p.message.speaker].name}<small>{p.message.recipient === undefined ? 'AI dialogue' : `to ${castaways[p.message.recipient].name}`}</small></strong><p>{p.message.text}</p>
    </article>)}
    <span className="sr-only speech-announcement" aria-live="polite">{messages.length ? `${castaways[messages[messages.length-1].speaker].name}: ${messages[messages.length-1].text}` : ''}</span>
  </div>
}
