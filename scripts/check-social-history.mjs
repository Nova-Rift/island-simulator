// Optional real-browser smoke test. Uses an isolated profile and text/DOM only.
// No screenshots, existing user profile or browser installation.
// Mock live responses only: no paid calls allowed.
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
  const {SocialGame}=await import('../src/social.mjs')
  const {scriptedDecision}=await import('../src/socialPolicy.ts')
  const game=new SocialGame(),actions=[]
  while(game.turn<12){const action=scriptedDecision(game.observe());actions.push(action);game.step(action)}
  await evaluate(`window.mockActions=${JSON.stringify(actions)};window.fetch=async(url)=>{
    if(url==='/api/island/status')return Response.json({ready:true});
    if(url==='/api/island/dialogue')throw Error('Unconfigured mock');
    throw Error('Unexpected fetch '+url)
  };window.fetch=async(url,options)=>{
    if(url==='/api/island/status')return Response.json({ready:true});
    const input=JSON.parse(options.body);
    return Response.json({text:JSON.stringify(input.messages[0].content.includes('Assess your situation')?{summary:'My ally may help, but I remain vulnerable.',winProbability:0.42}:window.mockActions.shift())})
  }`)
  await evaluate("document.querySelector('.social-paid input').click()")
  await delay(100)
  for(let i=0;i<12;i++){await click('Next turn');await delay(100)}
  assert.match(await evaluate("document.querySelector('.social-summaries').textContent"),/Own estimate of winning: 42%/)
  const chat=await evaluate("({text:document.querySelector('[aria-label=\"Messages in conversation 2\"]').textContent,count:document.querySelectorAll('[aria-label=\"Messages in conversation 2\"] .social-chat-message').length})")
  assert.equal(chat.count,2)
  assert.match(chat.text,/Leo, I would like us to support/)
  assert.match(chat.text,/I’m willing to listen/)
  assert.ok(await evaluate(`Array.from(document.querySelectorAll('.social-chat-message')).every(el=>{const next=el.nextElementSibling;return !next||el.getBoundingClientRect().bottom<=next.getBoundingClientRect().top})`))

  assert.match(await evaluate("document.querySelector('.social-transcript').textContent"),/Leo, I would like us to support/)
  await evaluate("document.querySelectorAll('.social-history select')[1].value='5';document.querySelectorAll('.social-history select')[1].dispatchEvent(new Event('change',{bubbles:true}))")
  assert.doesNotMatch(await evaluate("document.querySelector('.social-transcript').textContent"),/Leo, I would like us to support/)
  await click('Reset');await delay(100)
  assert.doesNotMatch(await evaluate("document.querySelector('.social-summaries').textContent"),/42%/)
  await evaluate("document.querySelector('.social-paid input').click()")
  await delay(100)
  for(let i=0;i<41;i++){await click('Next turn');await delay(30)}
  assert.match(await evaluate("document.querySelector('.social-transcript').textContent"),/Leo, I would like us to support/)
  assert.ok(await evaluate("document.querySelector('.social-history select').options.length>4"))
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
  assert.ok(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'))
  assert.deepEqual(errors,[]);console.log('History survives councils; audience filtering, mock AI assessments, reset and mobile width pass. No paid inference.')

} finally {
  ws?.close()
  if (chrome.exitCode === null) { chrome.kill('SIGTERM'); await new Promise(resolve => chrome.once('exit', resolve)) }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
}
