import { createServer } from 'node:http'
import { readFile,lstat } from 'node:fs/promises'
import { resolve,dirname,join } from 'node:path'
import { fileURLToPath,pathToFileURL } from 'node:url'
import { MAX_REQUEST_BYTES } from './server/runpod-client.mjs'
import { dialogueRoute } from './server/dialogue.mjs'
import { fileStore } from './server/file-store.mjs'
const root=dirname(fileURLToPath(import.meta.url))
const types={'index.html':'text/html; charset=utf-8','app.js':'text/javascript; charset=utf-8','app.css':'text/css; charset=utf-8'}
export async function loadKey(path) {
  if(!path)return ''
  const stat=await lstat(path)
  if(!stat.isFile() || stat.mode&0o077 || stat.uid!==process.getuid())throw new Error('Key file must be owned by you, regular, and mode 0600.')
  const key=(await readFile(path,'utf8')).trim()
  if(key.length<16 || key.length>4096 || /\s/.test(key))throw new Error('Invalid key file.')
  return key
}
export function createLocalServer({port=4174,apiKey='',openaiApiKey='',stateDirectory=join(root,'.local/state'),fetchImpl=fetch}={}) {
  const origin=`http://127.0.0.1:${port}`
  const env={RUNPOD_INFERENCE_KEY:apiKey,OPENAI_API_KEY:openaiApiKey,BUCKET:fileStore(stateDirectory)}
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store')
    res.setHeader('X-Content-Type-Options','nosniff')
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
    // Exact Host prevents DNS rebinding. Browser requests from another origin
    // cannot use this server as a paid proxy, even from malicious local pages.
    if(req.headers.host!==`127.0.0.1:${port}` || (req.headers.origin && req.headers.origin!==origin) || (req.headers['sec-fetch-site'] && !['same-origin','none'].includes(req.headers['sec-fetch-site']))) {
      res.writeHead(403);res.end('Local origin only');return
    }
    try {
      const url=new URL(req.url,origin)
      if(url.origin!==origin){res.writeHead(403);res.end('Local origin only');return}
      if(url.pathname.startsWith('/api/island/')) {
        if(req.method==='POST' && req.headers.origin!==origin){res.writeHead(403);res.end('Origin required');return}
        const chunks=[];let size=0
        for await(const chunk of req){size+=chunk.length;if(size>MAX_REQUEST_BYTES){res.writeHead(413,{'Content-Type':'application/json'});res.end(JSON.stringify({code:'CONTEXT_LIMIT',error:'Full personal history exceeds the request limit. Nothing was discarded.'}));return}chunks.push(chunk)}
        const body=Buffer.concat(chunks)
        const controller=new AbortController()
        res.on('close',()=>{if(!res.writableEnded)controller.abort()})
        const response=await dialogueRoute(new Request(url,{method:req.method,headers:req.headers,signal:controller.signal,...body.length?{body}:{}}),env,fetchImpl)
        res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return
      }
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end('Method not allowed');return}
      const name=url.pathname==='/'?'index.html':url.pathname.slice(1)
      if(!Object.hasOwn(types,name)){res.writeHead(404);res.end('Not found');return}
      const body=await readFile(join(root,'public',name))
      res.writeHead(200,{'Content-Type':types[name]});res.end(req.method==='HEAD'?undefined:body)
    }catch{res.writeHead(503);res.end('Local simulator request failed; private details withheld.')}
  })
  // Fixed host by design; do not bind to 0.0.0.0 or add public tunnels.
  return {server,listen:()=>new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',()=>ok(origin))})}
}
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  try {
    // Paid inference is off by default, including requests from stale browser tabs.
    const paidEnabled=process.env.ISLAND_ENABLE_PAID==='1'
    const key=paidEnabled?await loadKey(process.env.RUNPOD_KEY_FILE):''
    const defaultOpenAI=join(root,'.local/openai-api-key')
    const openaiApiKey=paidEnabled?(process.env.OPENAI_API_KEY || await loadKey(process.env.OPENAI_API_KEY_FILE || (await lstat(defaultOpenAI).catch(()=>null)?defaultOpenAI:undefined))):''
    const app=createLocalServer({apiKey:key,openaiApiKey})
    console.log(openaiApiKey?'OpenAI configured; inference requires a paid action.':'OpenAI not configured. Run npm run setup:openai to save a private key.')
    const url=await app.listen()
    console.log(`Local island simulator: ${url}`)
    console.log(key?'Paid Runpod ready. Inference starts only when you click Play with conversations.':'No Runpod key configured. Silent simulation is free; see README for optional paid setup.')
    for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.server.close(()=>process.exit(0)))
  }catch{console.error('Could not start. Check private key permissions, port 4174, and README. No credential printed.');process.exitCode=1}
}
