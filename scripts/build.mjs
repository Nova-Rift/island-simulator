import { build } from 'esbuild'
import { mkdir,writeFile } from 'node:fs/promises'
await mkdir('public',{recursive:true})
await build({entryPoints:['src/main.tsx'],bundle:true,format:'esm',target:'es2022',jsx:'automatic',outfile:'public/app.js',minify:true,define:{'process.env.NODE_ENV':'"production"'}})
await writeFile('public/index.html',`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local social simulator</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`)
console.log('Built standalone local simulator. No secrets or external browser scripts included.')
