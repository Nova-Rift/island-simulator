// Optional real-browser smoke test. Uses an isolated profile and text/DOM only.
// No screenshots, existing user profile or browser installation.
// Scripted social mode only: no paid calls allowed.
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
  await call('Network.enable')
  const paidCalls=[]
  ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.method==='Network.requestWillBeSent'&&/api\/island|runpod|huggingface|jsdelivr/.test(m.params.request.url))paidCalls.push(m.params.request.url)})
  assert.equal(await evaluate("document.querySelector('#social-title')?.textContent"),'Conversations & a vote')
  assert.equal(await evaluate("document.querySelector('.social-paid input')?.checked ?? false"),false)
  const seen=[]
  for(let turn=0;turn<40;turn++){
   await click('Next turn');await delay(70)
   const state=await evaluate(`({status:document.querySelector('.social-status').textContent,turn:document.querySelector('.social-state').textContent,
    bubbles:[...document.querySelectorAll('.social-speech')].map(e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom}})})`)
   seen.push(state.status)
   for(let a=0;a<state.bubbles.length;a++)for(let b=a+1;b<state.bubbles.length;b++){
    const x=state.bubbles[a],y=state.bubbles[b];assert.ok(Math.min(x.right,y.right)<=Math.max(x.left,y.left)||Math.min(x.bottom,y.bottom)<=Math.max(x.top,y.top),'Speech overlaps')
   }
   assert.match(state.turn,new RegExp('turn '+(turn+1)+'$'))
  }
  for(const action of ['asks to join','accepts','declines','excludes','leaves','casts a private ballot'])assert.ok(seen.some(s=>s.includes(action)),action)
  assert.equal(await evaluate("document.querySelectorAll('.social-results li').length"),8)
  assert.match(await evaluate("document.querySelector('.social-state').textContent"),/7 remain/)
  await click('Reset');await delay(100)
  assert.match(await evaluate("document.querySelector('.social-state').textContent"),/8 remain · turn 0/)
  await click('Play');await delay(1600);await click('Pause');await delay(100)
  const paused=await evaluate("document.querySelector('.social-state').textContent");assert.ok(!paused.endsWith('turn 0'))
  await delay(1600);assert.equal(await evaluate("document.querySelector('.social-state').textContent"),paused)
  for(const width of [1280,390]){
   await call('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:width<500})
   await click('Reset');await delay(100)
   for(let i=0;i<16;i++){await click('Next turn');await delay(40)}
   assert.ok(await evaluate("document.documentElement.scrollWidth<=window.innerWidth+1"),'Horizontal overflow')
   const bubbles=await evaluate("[...document.querySelectorAll('.social-speech')].map(e=>({client:e.clientWidth,scroll:e.scrollWidth}))")
   assert.ok(bubbles.every(b=>b.scroll<=b.client+1),'Speech overflows')
  }
  assert.deepEqual(paidCalls,[],'Scripted mode must not contact inference')
  assert.deepEqual(errors,[])
  console.log('Social browser checks passed: requests/consent/refusal/exclusion/leave, 8 votes, pause/reset, desktop/mobile text layout, zero inference calls or page exceptions.')

} finally {
  ws?.close()
  if (chrome.exitCode === null) { chrome.kill('SIGTERM'); await new Promise(resolve => chrome.once('exit', resolve)) }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
}
