// Optional real-browser smoke test. Uses an isolated profile and text/DOM only.
// No screenshots, existing user profile or browser installation.
// This performs one live council: Runpod requests are paid when not cached.
// Usage: node scripts/check-island-browser.mjs http://127.0.0.1:4173/
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import assert from 'node:assert/strict'
const profile = await mkdtemp('/tmp/island-chrome-')
const chrome = spawn('google-chrome', ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
let ws, sequence = 0
const pending = new Map(), errors = []
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
try {
  const endpoint = await new Promise((resolve, reject) => {
    let log = ''
    const timeout = setTimeout(() => reject(new Error('Chrome startup timed out')), 15_000)
    chrome.stderr.on('data', data => {
      log += data
      const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (match) { clearTimeout(timeout); resolve(match[1]) }
    })
    chrome.once('exit', code => { clearTimeout(timeout); reject(new Error(`Chrome exited ${code}: ${log.slice(-500)}`)) })
  })
  const targets = await (await fetch(`http://${new URL(endpoint).host}/json/list`)).json()
  ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id) {
      const request = pending.get(message.id); pending.delete(message.id)
      message.error ? request.reject(message.error) : request.resolve(message.result)
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails)
  })
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result?.value
  }
  const click = text => evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === ${JSON.stringify(text)})?.click()`)
  await call('Runtime.enable'); await call('Page.enable')
  await call('Page.navigate', { url: process.argv[2] || 'http://127.0.0.1:4173/' })
  await delay(3000)
  const started = performance.now()
  await call('Network.enable')
  const modelDownloads = []
  ws.addEventListener('message', event => { const m = JSON.parse(event.data); if (m.method === 'Network.requestWillBeSent' && /huggingface|jsdelivr|island-llm-worker/.test(m.params.request.url)) modelDownloads.push(m.params.request.url) })
  await click('Play with conversations')
  await delay(1000)
  const moving = await evaluate("document.querySelector('.simulation-status')?.textContent")
  assert.ok(moving && !moving.startsWith('Turn 0'), `Play did not move: ${moving}`)
  console.log('Play starts movement while loading:', moving)
  let observed = false, completed = false, firstSpeechMs = null
  for (let i = 0; i < 240; i++) {
    await delay(500)
    const state = await evaluate(`({error:document.querySelector('.island-model-overlay.has-error')?.innerText,
      speech:document.querySelector('.island-speech-bubble p')?.textContent,
      summary:Array.from(document.querySelectorAll('.castaway-thinking:has(small) p')).map(x => x.textContent).find(x => !x.includes('unavailable')),
      status:document.querySelector('.island-dialogue-controls')?.innerText,
      turn:document.querySelector('.simulation-status')?.textContent,
      summaries:[...document.querySelectorAll('.castaway-thinking p')].map(x=>x.textContent),
      llmVotes:[...document.querySelectorAll('small')].filter(x=>x.textContent==='LLM vote').length,
      bubbles:[...document.querySelectorAll('.island-speech-bubble')].map(x=>{const r=x.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom}})})`)
    assert.ok(!state.error, state.error)
    if (state.speech && state.summary && !state.summary.includes('unavailable')) {
      if (!observed) console.log('Real pretrained inference:', JSON.stringify({speech:state.speech,summary:state.summary}))
      observed = true
    }
    if (state.speech && firstSpeechMs === null) firstSpeechMs = Math.round(performance.now() - started)
    for (let a=0;a<state.bubbles.length;a++) for(let b=a+1;b<state.bubbles.length;b++) {
      const x=state.bubbles[a],y=state.bubbles[b]
      assert.ok(Math.min(x.right,y.right)-Math.max(x.left,y.left)<=2 || Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)<=2,'Speech bubbles overlap')
    }
    if (Number(state.turn?.match(/Turn (\d+)/)?.[1]) > 8) { completed = true; assert.equal(state.summaries.length,8); assert.ok(state.summaries.every(x=>x && !/unavailable|No conversation/.test(x))); assert.equal(state.llmVotes,8); await click('Pause'); console.log('Council completed:',JSON.stringify({firstSpeechMs,councilMs:Math.round(performance.now()-started),turn:state.turn})); break }
    if (i % 20 === 0) console.log('Waiting:', state.status)
  }
  assert.ok(observed, 'No real speech and summary within two minutes')
  assert.ok(completed, 'Council did not vote and resume')
  assert.deepEqual(modelDownloads, [], 'Homepage should not download a local model')
  await click('Reset'); await delay(100)
  assert.match(await evaluate("document.querySelector('.simulation-status')?.textContent"), /^Turn 0 · 8 of 8 castaways/)
  await click('Turn off AI dialogue')
  await click('Continue without dialogue'); await delay(3000)
  const continued = await evaluate("document.querySelector('.simulation-status')?.textContent")
  assert.ok(Number(continued.match(/Turn (\d+)/)?.[1]) > 8, continued)
  assert.deepEqual(errors, [])
  console.log('Reset and continued playback passed; no page exceptions.')
} finally {
  ws?.close()
  if (chrome.exitCode === null) { chrome.kill('SIGTERM'); await new Promise(resolve => chrome.once('exit', resolve)) }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
}
