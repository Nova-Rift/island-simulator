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
  await evaluate(`window.contextTestCalls=0;const original=window.fetch;window.fetch=async(url,options)=>{
    if(url==='/api/island/status')return Response.json({ready:true});
    if(url==='/api/island/dialogue'){window.contextTestCalls++;return window.contextTestCalls===1?Response.json({text:JSON.stringify(1)}):Response.json({code:'CONTEXT_LIMIT'},{status:413})}
    return original(url,options)
  }`)
  await evaluate("document.querySelector('.social-paid input').click()")
  await delay(100);await click('Next turn');await delay(100)
  assert.match(await evaluate("document.querySelector('.social-state').textContent"),/turn 1 ·/)
  await click('Play');await delay(1800)
  const state=await evaluate("({turn:document.querySelector('.social-state').textContent,error:document.querySelector('[role=alert]')?.textContent,summary:document.querySelector('.social-summaries p').textContent})")
  assert.match(state.turn,/turn 1 ·/);assert.match(state.error,/Paused without removing memories/);assert.equal(state.summary,'No conversation assessment yet.')
  const callsAfterPause=await evaluate('window.contextTestCalls');await delay(1800);assert.equal(await evaluate('window.contextTestCalls'),callsAfterPause)
  await click('Reset');await delay(50)
  await evaluate(`window.fetch=async(url)=>url==='/api/island/status'?Response.json({ready:true}):Response.json({code:'BUDGET_LIMIT'},{status:429})`)
  await click('Next turn');await delay(100)
  assert.match(await evaluate("document.querySelector('[role=alert]').textContent"),/conservative reservation limit/)
  assert.match(await evaluate("document.querySelector('.social-state').textContent"),/turn 0 ·/)
  await evaluate(`window.fetch=async(url)=>url==='/api/island/status'?Response.json({ready:true}):Response.json({text:'{"type":"say","text":"illegal while alone"}'})`)
  await click('Next turn');await delay(100)
  assert.match(await evaluate("document.querySelector('[role=alert]').textContent"),/valid constrained choice/)
  assert.match(await evaluate("document.querySelector('.social-state').textContent"),/turn 0 ·/)
  await click('Reset');await delay(50)
  await evaluate(`window.fetch=async(url,options)=>url==='/api/island/status'?Response.json({ready:true}):new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true})})`)
  await click('Next turn');await delay(1200)
  assert.match(await evaluate("document.querySelector('.social-status').textContent"),/Waiting on Runpod · 1s/)
  await click('Stop waiting');await delay(100)
  assert.match(await evaluate("document.querySelector('.social-state').textContent"),/turn 0 ·/)
  assert.match(await evaluate("document.querySelector('.social-status').textContent"),/Current game state kept/)
  assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Next turn').disabled"),false)
  await click('Reset');await delay(50)
  await evaluate(`window.parallelActors=[];window.fetch=async(url,options)=>{
   if(url==='/api/island/status')return Response.json({ready:true});
   const actor=JSON.parse(JSON.parse(options.body).messages[1].content).agent;window.parallelActors.push(actor);
   if(actor===0)return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true}));
   return Response.json({text:'0'})
  }`)
  await click('Play');await delay(250)
  assert.equal(await evaluate('new Set(window.parallelActors).size'),8)
  const progressed=await evaluate("Number(document.querySelector('.social-state').textContent.match(/turn (\\d+)/)[1])")
  assert.ok(progressed>=7,'Unrelated actors should advance while Maya waits')
  await click('Stop waiting');await delay(100)
  assert.match(await evaluate("document.querySelector('.social-state').textContent"),new RegExp('turn '+progressed+' ·'))
  await click('Reset');await delay(50)
  await evaluate(`window.clockSeen=[];window.fetch=async(url,options)=>{
    if(url==='/api/island/status')return Response.json({ready:true});
    const observation=JSON.parse(JSON.parse(options.body).messages[1].content);window.clockSeen.push(observation.voteClock);
    return Response.json({text:'0'})
  }`)
  await click('Play');await delay(1300);await click('Pause');await delay(50)
  const pausedClock=await evaluate("document.querySelector('.social-state strong').textContent")
  assert.match(pausedClock,/Vote 1 in 1:5[89]/)
  assert.ok(await evaluate('window.clockSeen.every(c=>c.secondsRemaining>0&&c.secondsRemaining<=120)'))
  await delay(1100);assert.equal(await evaluate("document.querySelector('.social-state strong').textContent"),pausedClock)
  const beforeSwitch=await evaluate("document.querySelector('.social-state').textContent")
  await evaluate(`var select=document.querySelector('[aria-label="Model provider"]');select.value='openai';select.dispatchEvent(new Event('change',{bubbles:true}));window.providerRequests=[];window.fetch=async(url,options)=>{if(url==='/api/island/status')return Response.json({providers:{openai:{ready:true},runpod:{ready:true}}});window.providerRequests.push(JSON.parse(options.body).provider);return Response.json({text:'0'})}`)
  await delay(50)
  assert.equal(await evaluate("document.querySelector('.social-state').textContent"),beforeSwitch)
  await delay(5000);await click('Next turn');await delay(100)
  assert.ok(await evaluate("window.providerRequests.length>0&&window.providerRequests.every(p=>p==='openai')"))
  await evaluate(`var select=document.querySelector('[aria-label="Model provider"]');select.value='runpod';select.dispatchEvent(new Event('change',{bubbles:true}))`);await delay(50)
  await click('Call vote now');await delay(50)
  assert.equal(await evaluate("document.querySelector('.social-state strong').textContent"),'Vote 1')
  assert.deepEqual(errors,[]);console.log('Context rejection pauses without advancing, losing intention, retrying, or supplying fallback actions.')

} finally {
  ws?.close()
  if (chrome.exitCode === null) { chrome.kill('SIGTERM'); await new Promise(resolve => chrome.once('exit', resolve)) }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
}
