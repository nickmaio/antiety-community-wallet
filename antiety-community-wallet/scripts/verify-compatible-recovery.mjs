import {readFile,realpath,readdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {join,resolve,sep} from 'node:path'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {ORIGIN_PROOF_CSP} from '../../shared/wallet/originProofHostingPolicy.js'
import {recoveryBrandContentType,recoveryHostingHeaders} from '../hosting/policy.js'
import {verifyRecoveryPublicBaseline} from './lib/recovery-public-baseline.mjs'

const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const args=process.argv.slice(2)
if(!args[0]||args.length>2||args[1]&&args[1]!=='--public-baseline')throw Error('Pass staged directory and optional --public-baseline')
const root=await realpath(resolve(args[0])),manifest=JSON.parse(await readFile(join(root,'STAGING.json'),'utf8'))
assert.equal(manifest.stage,'origin-compatible-recovery-hosting')
assert.equal(hash(await readFile(join(root,'src/worker.mjs'))),manifest.workerSha256)
assert.equal(hash(await readFile(join(root,'wrangler.jsonc'))),manifest.configSha256)
const assets=await realpath(join(root,'public')),contents=new Map(),actual=[]
async function walk(dir,prefix=''){
  for(const entry of await readdir(dir,{withFileTypes:true})){
    assert.equal(entry.isSymbolicLink(),false);const name=prefix+entry.name
    if(entry.isDirectory())await walk(join(dir,entry.name),name+'/')
    else {assert.equal(entry.isFile(),true);actual.push(name)}
  }
}
await walk(assets);assert.deepEqual(actual.sort(),Object.keys(manifest.files).sort())
for(const [file,expected]of Object.entries(manifest.files)){
  const path=await realpath(join(assets,file));assert.ok(path.startsWith(assets+sep))
  const bytes=await readFile(path);assert.equal(hash(bytes),expected,file);contents.set('/'+file,bytes)
}
const recoveryMetadata=JSON.parse(contents.get('/RECOVERY-BUILD.json'))
assert.equal(recoveryMetadata.antietyBackendRequired,false);assert.equal(recoveryMetadata.antietyLoginIncluded,false)
assert.equal(recoveryMetadata.sourceCryptoSha256,manifest.sourceCryptoSha256)
assert.equal(hash(contents.get('/'+manifest.recoveryArchiveName)),manifest.recoveryArchiveSha256)
assert.equal(manifest.recoveryArchiveName,'wallet-recovery-ethereum.zip')
const worker=(await import(pathToFileURL(join(root,'src/worker.mjs')))).default
let assetCalls=0,requests=0
const env={ASSETS:{fetch:async request=>{
  assetCalls++;const url=new URL(request.url);assert.equal(url.search,'')
  const bytes=contents.get(url.pathname);return new Response(bytes||'missing',{status:bytes?200:404})
}}}
async function check(path,{method='GET',expected,status=200,proof=false}={}){
  requests++;const result=await worker.fetch(new Request('https://wallet.antiety.com'+path,{method}),env)
  assert.equal(result.status,status,path)
  assert.equal(result.headers.get('Cache-Control'),'no-store')
  assert.equal(result.headers.get('Content-Security-Policy'),proof?ORIGIN_PROOF_CSP:recoveryHostingHeaders['Content-Security-Policy'])
  assert.equal(result.headers.get('Cross-Origin-Opener-Policy'),proof?'unsafe-none':'same-origin')
  const brandType=recoveryBrandContentType(path)
  if(brandType&&status===200)assert.equal(result.headers.get('Content-Type'),brandType)
  const body=Buffer.from(await result.arrayBuffer())
  if(method==='HEAD')assert.equal(body.length,0)
  else if(expected)assert.equal(hash(body),expected,path)
}
for(const [file,expected]of Object.entries(manifest.files)){
  const path=file==='production-wallet-origin-check.html'?'/production-wallet-origin-check':'/'+file
  const proof=path.startsWith('/production-wallet-origin-check')||path.startsWith('/assets/production-origin-check-')
  await check(path,{expected,proof});await check(path,{method:'HEAD',proof})
}
await check('/',{expected:manifest.files['index.html']})
await check('/.well-known/webauthn',{expected:manifest.baseline['/.well-known/webauthn']})
const before=assetCalls
for(const path of ['/auth/landing','/finance','/api/wallet/noncustodial/config','/assets/stale-core.js','/start.mjs','/browser-wallet-handoff'])await check(path,{status:404})
for(const path of ['/','/.well-known/webauthn'])await check(path,{method:'POST',status:405})
assert.equal(assetCalls,before)
const publicResult=args[1]?await verifyRecoveryPublicBaseline(manifest.baseline):{status:'PASSED',checks:[]}
if(publicResult.status!=='PASSED')process.exitCode=1
console.log(JSON.stringify({stage:'origin-compatible-recovery-verification',status:publicResult.status,files:contents.size,workerRequests:requests,
  recoveryBytesUnchanged:true,qualifiedCryptoIncluded:true,relatedOriginPreserved:true,deviceAssociationsPreserved:3,
  unknownAssetsBlocked:true,publicBaselineChecks:publicResult.checks,...(publicResult.failure?{failure:publicResult.failure}:{}),
  networkUsed:!!args[1],deployed:false,realWalletOrExportRead:false,transactionSubmitted:false}))
