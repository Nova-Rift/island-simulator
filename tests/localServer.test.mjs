import { request as httpRequest } from 'node:http'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,rm,writeFile,chmod,symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { createLocalServer,loadKey } from '../server.mjs'
import { fileStore } from '../server/file-store.mjs'
import { reserveBudget,TOKEN_BUDGET } from '../server/dialogue.mjs'
const request={json:false,messages:[{role:'system',content:'You write natural dialogue for characters in an island survival game.'},{role:'user',content:'Maya says hello.'}]}
test('loopback server rejects cross-origin, rebinding and secret paths; only same-origin valid POST can pay',async()=>{
 const dir=await mkdtemp('/tmp/island-server-test-');let calls=0
 const app=createLocalServer({port:14174,stateDirectory:dir,apiKey:'test-secret-key-123',fetchImpl:async()=>{calls++;return Response.json({choices:[{message:{content:'Let us share food.'},finish_reason:'stop'}]})}})
 try{
  const origin=await app.listen();assert.equal(app.server.address().address,'127.0.0.1')
  for(const headers of [{},{Origin:'https://evil.example'},{Origin:origin,Host:'evil.example:14174'},{Origin:origin,'Sec-Fetch-Site':'cross-site'}]){
   const status=await new Promise((resolve,reject)=>{const req=httpRequest(origin+'/api/island/dialogue',{method:'POST',headers:{'Content-Type':'application/json',...headers}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});req.on('error',reject);req.end(JSON.stringify(request))});assert.equal(status,403,JSON.stringify(headers))
  }
  for(const path of ['/.env','/.local/runpod-key','/server.mjs','/server/runpod-client.mjs'])assert.equal((await fetch(origin+path)).status,404)
  assert.equal(calls,0)
  const options={method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(request)}
  const r=await fetch(origin+'/api/island/dialogue',options);assert.equal(r.status,200);assert.ok(!(await r.text()).includes('test-secret'))
  assert.equal((await (await fetch(origin+'/api/island/dialogue',options)).json()).cached,true)
  assert.equal(calls,1)
 }finally{await new Promise(r=>app.server.close(r));await rm(dir,{recursive:true,force:true})}
})
test('disk budget compare-and-swap survives restarts and concurrent requests cannot overspend',async()=>{
 const dir=await mkdtemp('/tmp/island-store-test-')
 try{
  const store=fileStore(dir)
  const results=await Promise.all(Array.from({length:8},()=>reserveBudget(store,TOKEN_BUDGET)))
  assert.equal(results.filter(Boolean).length,1)
  assert.equal(await reserveBudget(fileStore(dir),1),false)
 }finally{await rm(dir,{recursive:true,force:true})}
})
test('private key loading rejects world-readable files and symlinks',async()=>{
 const dir=await mkdtemp('/tmp/island-key-test-'),path=join(dir,'key')
 try{await writeFile(path,'test-key-private-123',{mode:0o600});assert.equal(await loadKey(path),'test-key-private-123');await chmod(path,0o644);await assert.rejects(loadKey(path));assert.equal(await loadKey(), '');await chmod(path,0o600);await symlink(path,join(dir,'link'));await assert.rejects(loadKey(join(dir,'link')))}
 finally{await rm(dir,{recursive:true,force:true})}
})
