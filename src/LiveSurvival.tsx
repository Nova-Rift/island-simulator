import { useEffect, useRef, useState } from 'react'
import { IslandGame } from './simulation/island-game.mjs'
import { drawIslandFrame } from './simulation/island-renderer.mjs'
import provenance from './simulation/provenance.json'
import { castaways, castawayActivity, eliminationReason, cellAt, describeCell } from './islandPresentation'
import type { PointerEvent, KeyboardEvent } from 'react'
import { IslandSpeech } from './IslandSpeech'
import { generateCouncil } from './islandLanguage'
import { ServerLanguageModel } from './serverLanguage'
import { IslandPlayback } from './islandPlayback'
import type { AgentThinking, CampMessage, IslandLanguageModel } from './islandLanguage'

export function LiveSurvival() {
  const [runtime] = useState(() => new IslandGame({ seed: 0 }))
  const [playback] = useState(() => new IslandPlayback(runtime))
  const [silentPlay, setSilentPlay] = useState(false)
  const [councilStatus, setCouncilStatus] = useState('')
  const [frame, setFrame] = useState(() => runtime.frame())
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [activity, setActivity] = useState(() => castaways.map(() => 'Scouting for food'))
  const [thinking, setThinking] = useState<(AgentThinking | null)[]>(() => castaways.map(() => null))
  const [messages, setMessages] = useState<CampMessage[]>([])
  const [languageModel, setLanguageModel] = useState<IslandLanguageModel | null>(null)
  const modelRef = useRef<ServerLanguageModel | null>(null)
  const loadRun = useRef(0)
  const autoCouncil = useRef('')
  const [modelLoading, setModelLoading] = useState(false)
  const [modelError, setModelError] = useState('')
  const [modelStatus, setModelStatus] = useState('Play starts the island with server-powered conversations.')
  const [councilBusy, setCouncilBusy] = useState(false)
  const [dialogueError, setDialogueError] = useState('')
  const councilRun = useRef(0)
  const [inspectedCell, setInspectedCell] = useState<[number, number] | null>(null)
  const previousFrame = useRef<typeof frame | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const config = runtime.world.config
  const alive = frame.alive.filter(Boolean).length
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const draw = () => {
      const bounds = element.getBoundingClientRect()
      const scale = Math.min(window.devicePixelRatio || 1, 2)
      element.width = Math.max(1, Math.round(bounds.width * scale))
      element.height = Math.max(1, Math.round(bounds.height * scale))
      const context = element.getContext('2d')
      if (context) drawIslandFrame(context, frame, config, previousFrame.current)
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(element)
    previousFrame.current = frame
    return () => observer.disconnect()
  }, [frame, config])
  useEffect(() => {
    if (!playing || frame.phase !== 'survival') return
    const timer = window.setInterval(() => {
      const before = runtime.frame()
      const next = playback.advance()
      setActivity(next.alive.map((_, i) => castawayActivity(before, next, runtime.world.config, i)))
      setFrame(next)
      if (!playback.running) setPlaying(false)
    }, 240 / speed)
    return () => window.clearInterval(timer)
  }, [runtime, playback, playing, speed, frame.phase])
  function startPlayback() {
    autoCouncil.current = ''; setDialogueError('')
    playback.play(); setPlaying(playback.running)
  }
  function toggle() {
    if (playing) { playback.pause(); setPlaying(false) }
    else if (modelLoading) startPlayback()
    else if (!languageModel) { setSilentPlay(false); void enableDialogue() }
    else startPlayback()
  }
  function playSilently() {
    stopDialogue(); setSilentPlay(true)
    setModelStatus('Silent mode: scripted movement and automatic game-rule votes. No conversations.')
    startPlayback()
  }
  function stopDialogue() {
    playback.pause(); setPlaying(false); setSilentPlay(false)
    setModelError('')
    loadRun.current++; councilRun.current++
    modelRef.current?.dispose(); modelRef.current = null
    setLanguageModel(null); setModelLoading(false); setCouncilBusy(false)
    setModelStatus('AI dialogue is off. Press Play to reconnect.')
  }
  async function enableDialogue() {
    if (modelLoading || languageModel) return
    const run = ++loadRun.current
    setModelLoading(true); setModelError(''); setModelStatus('Connecting to Runpod. The island is running…'); setDialogueError('')
    startPlayback()
    let model: ServerLanguageModel | null = null
    try {
      model = new ServerLanguageModel()
      modelRef.current = model
      const name = await model.load()
      if (loadRun.current !== run) { model.dispose(); return }
      setLanguageModel(model); autoCouncil.current = ''
      setModelStatus(`${name} ready. Conversations start at council.`)
    } catch (error) {
      model?.dispose()
      if (loadRun.current === run) {
        modelRef.current = null
        playback.pause(); setPlaying(false)
        const message = `AI dialogue could not connect: ${error instanceof Error ? error.message : String(error)}`
        setModelStatus(message); setModelError(message)
      }
    } finally { if (loadRun.current === run) setModelLoading(false) }
  }
  function reset(newSeed = runtime.seed) {
    if (councilBusy || modelLoading) stopDialogue()
    councilRun.current++; autoCouncil.current = ''
    setModelError(''); setModelStatus(languageModel ? 'Ready. Press Play to start again.' : 'Reset to turn 0. Press Play to start; all eight castaways are back.')
    setCouncilStatus(''); setMessages([]); setThinking(castaways.map(() => null)); setCouncilBusy(false); setDialogueError('')
    setInspectedCell(null)
    previousFrame.current = null
    setActivity(castaways.map(() => 'Scouting for food'))
    setFrame(playback.reset(newSeed)); setPlaying(false)
  }
  async function runCouncil(useRules = false) {
    if (runtime.phase !== 'council' || councilBusy) return
    const run = ++councilRun.current
    setCouncilBusy(true); setDialogueError(''); setCouncilStatus('Preparing the first conversation…')
    try {
      const fallback = runtime.ruleBallots()
      const ballots = languageModel && !useRules
        ? await generateCouncil(languageModel, runtime.frame(), config, messages, fallback,
          () => councilRun.current === run,
          message => setMessages(current => [...current, message].slice(-64)),
          (agent, summary) => setThinking(current => current.map((value, i) => i === agent ? summary : value)), thinking, setCouncilStatus, async () => { await new Promise(resolve => setTimeout(resolve, 1800 / speed)) })
        : fallback
      if (councilRun.current !== run) return
      setFrame(playback.resolveCouncil(ballots)); setPlaying(playback.running)
    } catch {
      if (councilRun.current === run) {
        playback.pause(); setPlaying(false)
        modelRef.current?.dispose(); modelRef.current = null; setLanguageModel(null)
        setModelStatus('AI dialogue stopped. Play reconnects and retries this council.')
        setDialogueError('The conversation could not finish. Press Play to retry, or continue without dialogue.')
        setModelError('The conversation could not finish. Press Play to retry, or continue without dialogue.')
      }
    } finally {
      if (councilRun.current === run) setCouncilBusy(false)
    }
  }
  useEffect(() => {
    const key = `${runtime.seed}:${frame.tick}`
    if (playing && (languageModel || silentPlay) && frame.phase === 'council' && !councilBusy && autoCouncil.current !== key) {
      autoCouncil.current = key
      void runCouncil()
    }
  }, [languageModel, silentPlay, playing, frame.phase, frame.tick, councilBusy])
  useEffect(() => () => { councilRun.current++; loadRun.current++; modelRef.current?.dispose() }, [])
  function inspect(event: PointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    setInspectedCell(cellAt(event.clientX - bounds.left, event.clientY - bounds.top, bounds.width, bounds.height, config.size))
  }
  function inspectKeyboard(event: KeyboardEvent<HTMLCanvasElement>) {
    if (event.key === 'Escape') { setInspectedCell(null); return }
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    if (!moves[event.key]) return
    event.preventDefault()
    const [dy, dx] = moves[event.key]
    setInspectedCell(current => { const [row, col] = current ?? [0, 0]; return [Math.max(0, Math.min(config.size - 1, row + dy)), Math.max(0, Math.min(config.size - 1, col + dx))] })
  }
  return <section className="survival-replay live-survival island-survival" aria-labelledby="survival-demo-title">
    <div className="survival-demo-heading"><h2 id="survival-demo-title">Island survival</h2><span>8 castaways · one island</span></div>
    <p className="survival-demo-note">Scripted movement · {languageModel ? 'Pretrained AI dialogue & votes' : 'AI dialogue off'}</p>
    <p className="meadow-intro">Find food. Avoid storms. Vote every {runtime.councilEvery} turns. Last castaway standing wins.</p>
    <p className="island-objective">Reward: winner +1 · everyone else 0 </p>
    <div className="simulation-layout">
    <div className="simulation-board-panel">
    <div className="island-viewport" onPointerLeave={event => { if (event.pointerType === 'mouse') setInspectedCell(null) }} onKeyDown={event => { if (event.key === 'Escape') setInspectedCell(null) }}>
    <canvas ref={canvas} width="1536" height="576" className="survival-demo-world" role="img" tabIndex={0}
      onPointerMove={event => { if (event.pointerType === 'mouse') inspect(event) }} onPointerDown={inspect}
      onFocus={() => setInspectedCell([0, 0])} onBlur={() => setInspectedCell(null)} onKeyDown={inspectKeyboard}
      aria-describedby={inspectedCell ? 'island-hover-card' : 'island-inspect-help'}
      aria-label={`Island, turn ${frame.tick}; ${alive} of ${config.agents} castaways remain. Use arrow keys to inspect cells; Escape closes the explanation. Live statistics below.`}>
      Eight castaways search for fruit and avoid storms. Live state is listed below.
    </canvas>
    {(modelLoading || modelError || (councilBusy && !messages.some(message => message.council === frame.councils.length + 1))) && <div className={`island-model-overlay${modelError ? ' has-error' : ''}`} role={modelError ? 'alert' : 'status'}>
      <strong>{modelError ? 'Conversations could not start' : !modelLoading ? 'Council conversation is starting' : frame.phase === 'council' ? 'Council is waiting for AI dialogue' : 'Island running · loading conversations'}</strong>
      {!modelError && <progress aria-label="Preparing AI dialogue" />}
      <p>{modelError || (modelLoading ? modelStatus : councilStatus)}</p>
      {modelError && <button type="button" onClick={playSilently}>Continue without dialogue</button>}
    </div>}
    <IslandSpeech messages={messages.filter(message => message.council === frame.councils.length + (frame.phase === 'council' ? 1 : 0))} positions={frame.positions} size={config.size} />
    {inspectedCell && <div id="island-hover-card" className="island-hover-card" role="tooltip" style={{
      left: inspectedCell[1] < config.size / 2 ? 'auto' : '8px', right: inspectedCell[1] < config.size / 2 ? '8px' : 'auto',
      top: inspectedCell[0] < config.size / 2 ? 'auto' : '8px', bottom: inspectedCell[0] < config.size / 2 ? '8px' : 'auto',
    }}>
      <small>Row {inspectedCell[0] + 1} · column {inspectedCell[1] + 1} · turn {frame.tick}</small>
      {describeCell(frame, config, ...inspectedCell, activity).map(entry => <div key={entry.title}><strong>{entry.title}</strong><p>{entry.detail}</p></div>)}
    </div>}
    </div>
    <div className="survival-demo-controls">
      <button type="button" onClick={toggle} disabled={runtime.done}>{playing ? (councilBusy ? 'Pause after council' : 'Pause') : modelLoading ? 'Resume while loading' : languageModel ? 'Play' : 'Play with conversations'}</button>
      <button type="button" onClick={() => reset()}>Reset</button>
      <button type="button" onClick={() => reset((runtime.seed + 1) >>> 0)}>New island</button>
      <label className="simulation-speed">Speed <select aria-label="Simulation display speed" value={speed} onChange={event => { const value = Number(event.target.value); runtime.setSpeed(value); setSpeed(value) }}>
        <option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option>
      </select></label>
      <span className="simulation-status">Turn {frame.tick} · {alive} of {config.agents} castaways remain{frame.phase === 'council' ? ' · council time' : runtime.done ? ' · game over' : ''}</span>
    </div>
    <div className="island-dialogue-controls">
      <div>{modelLoading && <button type="button" onClick={stopDialogue}>Cancel connection</button>}
      {(!languageModel || dialogueError) && !modelLoading && !councilBusy && !runtime.done && <button type="button" onClick={playSilently}>Continue without dialogue</button>}
      {languageModel && <button type="button" onClick={stopDialogue}>Turn off AI dialogue</button>}
      <span role="status">{modelLoading ? modelStatus : frame.phase === 'council' ? `Council ${frame.councils.length + 1} · ${councilBusy ? councilStatus : 'Ready to discuss and vote. Press Play to continue.'}${councilBusy ? playing ? ' The game continues after voting.' : ' The game will pause after voting.' : ''}` : modelStatus}</span></div>
      {frame.phase === 'council' && !modelLoading && !councilBusy && <p role="status">{modelStatus}</p>}
      {dialogueError && <p className="conversation-error" role="alert">{dialogueError}</p>}
      {!languageModel && <small>Conversations run on Runpod. No model download needed.</small>}
    </div>
    <p id="island-inspect-help" className="simulation-legend island-legend"><span>Fruit → energy</span><span>Rain clouds → storm zones</span><span>Numbers → castaway cards</span><span>Hover / tap to inspect · keyboard: arrow keys</span></p>
    </div>
    {frame.phase === 'finished' && <div className="island-result" role="status">{frame.winner === null ? 'No winner — nobody survived the island.' : `${castaways[frame.winner].name} wins the island! Reward +1; everyone else 0.`}<button type="button" onClick={() => reset((runtime.seed + 1) >>> 0)}>Play another island</button></div>}
    <aside className="simulation-inspector" aria-label="Game rules and live castaway statistics">
      <div className="simulation-inspector-heading"><h3>The castaways</h3><span>Live · turn {frame.tick}</span></div>
      <div className="simulation-stats mouse-card-grid" aria-label="Live castaway statistics">
        {frame.alive.map((operational, i) => <article key={i} className={`mouse-stat-card${operational ? '' : ' agent-offline'}`} aria-labelledby={`castaway-name-${i}`}>
          <h4 id={`castaway-name-${i}`} className="simulation-agent-id"><i style={{ backgroundColor: `hsl(${i * 45},65%,47%)` }} aria-hidden="true" /><span>#{i + 1} {castaways[i].name}</span></h4>
          <p className="mouse-activity">{operational ? activity[i] : `Out · ${eliminationReason(frame.failureCauses[i])}`}</p>
          <dl className="mouse-metrics">
            <div><dt>Energy</dt><dd>{frame.power[i]}<small>/{config.power_limit}</small><progress aria-label={`${castaways[i].name} energy`} value={frame.power[i]} max={config.power_limit} className="stat-power" /></dd></div>
            <div><dt>Health</dt><dd>{frame.integrity[i]}<small>/{config.max_integrity}</small><progress aria-label={`${castaways[i].name} health`} value={frame.integrity[i]} max={config.max_integrity} className="stat-integrity" /></dd></div>
            <div><dt>Exposure</dt><dd>{frame.wear[i]}<small>/{config.wear_limit}</small><progress aria-label={`${castaways[i].name} exposure`} value={frame.wear[i]} max={config.wear_limit} className="stat-wear" /></dd></div>
          </dl>
          <div className="castaway-thinking"><span>Current thinking</span><p>{thinking[i]?.text ?? (thinking[i]?.status === 'unavailable' ? 'Summary unavailable for this exchange.' : languageModel ? 'No conversation yet.' : 'Awaiting AI dialogue.')}</p>{thinking[i] && <small>After talking with {castaways[thinking[i]!.partner].name} · council {thinking[i]!.council}</small>}</div>
        </article>)}
      </div>
      <section className="island-council" aria-labelledby="council-title">
        <div className="simulation-inspector-heading"><h3 id="council-title">Island council</h3><span>Every {runtime.councilEvery} turns</span></div>
        <p>{frame.phase === 'council' ? 'The world waits while every remaining castaway discusses and votes. Playback continues afterward unless paused.' : 'Most votes means elimination. Ties use a seeded draw.'}</p>

        {frame.councils.slice().reverse().map(round => <details key={round.number} open={round.number === frame.councils.length}>
          <summary>Council {round.number} · turn {round.tick}: {castaways[round.eliminated].name} voted out{round.tied ? ' (tie-break draw)' : ''}</summary>
          <ul>{round.ballots.map(vote => <li key={vote.voter}><strong>{castaways[vote.voter].name} → {castaways[vote.target].name}</strong><span>{vote.reason}</span><small>{vote.source === 'llm' ? 'LLM vote' : vote.source === 'agent' ? 'Custom-agent vote' : 'Game-rule vote'}</small></li>)}</ul>
        </details>)}
      </section>
      <details className="simulation-rules">
        <summary>Game rules</summary>
        <ul>
          <li><strong>Find food.</strong> Every turn costs 1 energy, including waiting. A portion of fruit restores energy to {config.power_limit}. Zero energy means elimination. Up to {config.resources_per_step} new portions grow per turn.</li>
          <li><strong>Compete for space.</strong> All {config.agents} castaways follow the same survival rules. Food is shared and consumed once. Occupied cells and contested moves block movement.</li>
          <li><strong>Weather the storms.</strong> {config.hazard_count} marked zones switch between stormy and calm every {config.hazard_period / 2} turns. Active storms cost {config.hazard_damage} health per turn. Zero health means elimination.</li>
          <li><strong>Win the game.</strong> The last remaining castaway receives +1; everyone else receives 0. There are no per-turn rewards. If everyone is eliminated together, nobody wins.</li>
          <li><strong>Vote someone off.</strong> Every {runtime.councilEvery} turns, all remaining players must vote once for another player. The most votes eliminates a player; a seeded draw resolves ties.</li>
          <li><strong>Face exposure.</strong> Exposure rises every turn. At {config.wear_limit}, a castaway is eliminated. This fixed game limit cannot be reversed by food; it is a simplified rule, not a model of human biology.</li>
          <li><strong>Limited information.</strong> Each castaway sees only {config.radius} cells in every direction. Pause stops the world. This version has voting councils and no immunity challenges.</li>
        </ul>
      </details>
    </aside>
    </div>
    <details className="simulation-details"><summary>Model status & source</summary>
      <p>Movement is scripted. When enabled, pretrained Qwen3-32B-AWQ generates dialogue, state summaries and votes through Runpod. Identical requests can reuse cached model responses. Invalid model votes use labeled game-rule votes. This does not demonstrate learned survival or cooperation; the research model is separate. <a href="https://github.com/Nova-Rift/survival-env">Environment API →</a></p>
      <p className="small-note">Environment <a href={`${provenance.repository}/tree/${provenance.commit}/browser`}>island-survival-v1 · {provenance.commit.slice(0, 7)}</a>. Original island survival game; not affiliated with CBS or Survivor.</p>
    </details>
  </section>
}
