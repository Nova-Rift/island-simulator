import { mkdir,readFile,writeFile,rename } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'

// One loopback server owns this directory. Serialize compare-and-swap operations
// and commit with atomic rename; the conservative budget survives restarts.
export function fileStore(directory) {
  let queue=Promise.resolve()
  const filename=key=>join(directory,createHash('sha256').update(key).digest('hex')+'.json')
  const get=async key=>{
    try {const v=JSON.parse(await readFile(filename(key),'utf8'));return {...v,text:async()=>v.value,json:async()=>JSON.parse(v.value)}}
    catch(error){if(error.code==='ENOENT')return null;throw error}
  }
  return {
    get,
    put(key,value,options={}) {
      const operation=queue.then(async()=>{
        await mkdir(directory,{recursive:true,mode:0o700})
        const old=await get(key)
        if(options.onlyIf?.etagMatches && old?.etag!==options.onlyIf.etagMatches)return null
        if(options.onlyIf instanceof Headers && options.onlyIf.get('If-None-Match')==='*' && old)return null
        const next={etag:randomUUID(),value},file=filename(key),temp=file+'.tmp'
        await writeFile(temp,JSON.stringify(next),{mode:0o600});await rename(temp,file)
        return next
      })
      queue=operation.catch(()=>{})
      return operation
    },
  }
}
