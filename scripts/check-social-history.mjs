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
  while(game.turn<20){const action=scriptedDecision(game.observe());actions.push(action.type==='invite'?{...action,group:999}:action);game.step(action)}
  await evaluate(`window.rankingCalls=0;window.reviewSnapshots=[];window.mockActions=${JSON.stringify(actions)};window.fetch=async(url)=>{
    if(url==='/api/island/status')return Response.json({ready:true});
    if(url==='/api/island/dialogue')throw Error('Unconfigured mock');
    throw Error('Unexpected fetch '+url)
  };window.fetch=async(url,options)=>{
    if(url==='/api/island/status')return Response.json({ready:true});
    const input=JSON.parse(options.body);window.lastPrompt=input.messages[0].content;const observation=JSON.parse(input.messages[1].content);let output;
    if(observation.game&&observation.player===undefined){window.rankingCalls++;output={order:observation.game.alive.flatMap((alive,id)=>alive?[id]:[])}}
    else if(observation.game){window.reviewSnapshots.push(observation.game);output={summary:'Snapshot recap at turn '+observation.game.turn}}
    else if(input.schema){const action=window.mockActions.shift();window.lastAction=action;output=observation.choices.find(c=>c.action.type===action.type&&c.action.target===action.target&&(c.action.group===undefined||c.action.group===action.group)).choice}
    else if(observation.selectedAction)output={text:window.lastAction.text||'',reason:window.lastAction.reason||''};
    else output={summary:'My ally may help, but I remain vulnerable.',winProbability:0.42};
    return Response.json({text:JSON.stringify(output)})
  }`)
  await evaluate("document.querySelector('.social-paid input').click()")
  await delay(100)
  await evaluate(`document.querySelector('.social-prompt').open=true;const textarea=document.querySelector('#agent-starting-prompt');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(textarea,textarea.value+' CUSTOM_PROMPT_CHECK');textarea.dispatchEvent(new Event('input',{bubbles:true}))`)
  await delay(50)
  await click('Next turn');await delay(100)
  assert.match(await evaluate('window.lastPrompt'),/CUSTOM_PROMPT_CHECK/)
  assert.match(await evaluate('window.lastPrompt'),/You are Maya/)
  assert.equal(await evaluate("document.querySelectorAll('.social-group:not(.social-alone)').length"),0)
  assert.match(await evaluate("document.querySelector('.social-pending-invitations').textContent"),/Maya invited Theo/)
  assert.equal(await evaluate("document.querySelectorAll('.social-alone .social-person').length"),8)

  await click('Summarize game so far (paid)');await delay(300)
  assert.equal(await evaluate('window.reviewSnapshots.length'),8)
  assert.equal(await evaluate('window.rankingCalls'),1)
  assert.equal(await evaluate("document.querySelector('.social-review article strong').textContent"),'#1 · Kai')
  assert.equal(await evaluate("document.querySelector('.social-review article small').textContent"),'Predicted winner')
  assert.match(await evaluate("document.querySelector('.social-review').textContent"),/Snapshot at turn 1/)
  assert.match(await evaluate("document.querySelector('.social-state').textContent"),/turn 1 ·/)

  for(let i=1;i<20;i++){await click('Next turn');await delay(100)}
  assert.match(await evaluate("document.querySelector('.social-summaries').textContent"),/Own estimate of winning: 42%/)
  const chat=await evaluate("({text:document.querySelector('[aria-label=\"Messages in conversation 1\"]').textContent,count:document.querySelectorAll('[aria-label=\"Messages in conversation 1\"] .social-chat-message').length})")
  assert.equal(chat.count,3)
  assert.match(chat.text,/Theo, I would like us to support/)
  assert.match(chat.text,/I’m willing to listen/)
  assert.ok(await evaluate(`Array.from(document.querySelectorAll('.social-chat-message')).every(el=>{const next=el.nextElementSibling;return !next||el.getBoundingClientRect().bottom<=next.getBoundingClientRect().top})`))

  assert.match(await evaluate("document.querySelector('.social-transcript').textContent"),/Theo, I would like us to support/)
  await evaluate("document.querySelectorAll('.social-history select')[1].value='5';document.querySelectorAll('.social-history select')[1].dispatchEvent(new Event('change',{bubbles:true}))")
  assert.doesNotMatch(await evaluate("document.querySelector('.social-transcript').textContent"),/Theo, I would like us to support/)
  await click('Summarize game so far (paid)');await delay(300)
  assert.equal(await evaluate('window.reviewSnapshots.length'),16)
  assert.equal(await evaluate('window.rankingCalls'),2)
  assert.match(await evaluate("document.querySelector('.social-review').textContent"),/Snapshot at turn 20/)
  assert.ok(await evaluate("Array.from(document.querySelectorAll('.social-review article p')).every(p=>p.textContent==='Snapshot recap at turn 20')"))
  assert.ok(await evaluate('window.reviewSnapshots.every(s=>s.phase!=="finished"&&s.winner===null)'))
  await click('Reset');await delay(100)
  assert.doesNotMatch(await evaluate("document.querySelector('.social-summaries').textContent"),/42%/)
  await evaluate("document.querySelector('.social-paid input').click()")
  await delay(100)
  for(let i=0;i<41;i++){await click('Next turn');await delay(30)}
  assert.match(await evaluate("document.querySelector('.social-transcript').textContent"),/Theo, I would like us to support/)
  assert.ok(await evaluate("document.querySelector('.social-history select').options.length>4"))
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
  assert.ok(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'))
  for(let turns=0;turns<200;turns++){
   if(await evaluate("!!document.querySelector('#game-review-title')"))break
   await click('Next turn');await delay(25)
  }
  assert.ok(await evaluate("!!document.querySelector('#game-review-title')"))
  assert.equal(await evaluate("document.querySelectorAll('.social-review .social-summaries article').length"),8)
  await evaluate(`window.reviewCalls=0;window.fetch=async(url,options)=>{
   if(url==='/api/island/status')return Response.json({ready:true});
   const input=JSON.parse(options.body),payload=JSON.parse(input.messages[1].content);
   if(payload.game.phase!=='finished'||payload.game.events.length<100||payload.game.councils.length!==6)throw Error('Incomplete review evidence');
   window.reviewCalls++;return Response.json({text:JSON.stringify({summary:'A short evidence-based recap for player '+payload.player})})
  }`)
  await click('Generate AI recap (paid)');await delay(400)
  assert.equal(await evaluate('window.reviewCalls'),8)
  assert.equal(await evaluate("Array.from(document.querySelectorAll('.social-review article p')).filter(p=>p.textContent.includes('evidence-based recap')).length"),8)
  assert.deepEqual(errors,[]);console.log('History survives councils; audience filtering, mock AI assessments, reset and mobile width pass. No paid inference.')

} finally {
  ws?.close()
  if (chrome.exitCode === null) { chrome.kill('SIGTERM'); await new Promise(resolve => chrome.once('exit', resolve)) }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
}
