import {readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import {ORIGIN_PROOF_CSP} from '../../shared/wallet/originProofHostingPolicy.js'
import {recoveryBrandContentType,recoveryHostingHeaders} from '../hosting/policy.js'

const args=process.argv.slice(2)
if(args.length<3||args.length>4||args[3]&&args[3]!=='--metadata-only')throw Error('Pass candidate directory, unrelated-origins baseline JSON, output JSON and optional --metadata-only')
const metadataOnly=args[3]==='--metadata-only',unverifiedBodies=[]
const candidate=resolve(args[0]),manifest=JSON.parse(await readFile(join(candidate,'STAGING.json'),'utf8'))
const baseline=JSON.parse(await readFile(args[1],'utf8')),checks=[]
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
async function readPublic(url,{method='GET',redirect='manual'}={}){
  const attempts=['GET','HEAD'].includes(method)?2:1
  for(let attempt=0;attempt<attempts;attempt++){
    try{
      const response=await fetch(url,{method,cache:'no-store',redirect,signal:AbortSignal.timeout(45000)})
      const bytes=Buffer.from(await response.arrayBuffer())
      return {response,bytes}
    }catch(error){if(attempt+1===attempts)throw error}
  }
}
async function check(path,{method='GET',expected,status=200,proof=false}={}){
  const {response,bytes}=await readPublic('https://wallet.antiety.com'+path,{method})
  assert.equal(response.status,status,path)
  assert.equal(response.headers.get('Cache-Control'),'no-store',path)
  assert.equal(response.headers.get('Content-Security-Policy'),proof?ORIGIN_PROOF_CSP:recoveryHostingHeaders['Content-Security-Policy'],path)
  assert.equal(response.headers.get('Cross-Origin-Opener-Policy'),proof?'unsafe-none':'same-origin',path)
  assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff',path)
  assert.equal(response.headers.get('X-Frame-Options'),'DENY',path)
  assert.equal(response.headers.get('Clear-Site-Data'),null,path)
  if(path.startsWith('/.well-known/')&&status===200)assert.match(response.headers.get('Content-Type'),/^application\/json/)
  if(path.endsWith('.js')&&status===200)assert.match(response.headers.get('Content-Type'),/^(?:application|text)\/javascript/)
  if(path.endsWith('.zip')&&status===200)assert.match(response.headers.get('Content-Disposition'),/^attachment;/)
  const brandType=recoveryBrandContentType(path)
  if(brandType&&status===200)assert.equal(response.headers.get('Content-Type'),brandType)
  if(method==='POST')assert.equal(response.headers.get('Allow'),'GET, HEAD')
  if(method==='HEAD')assert.equal(bytes.length,0)
  else if(expected)assert.equal(hash(bytes),expected,path)
  checks.push({path,method,status,...(expected?{sha256:expected}:{}),headersVerified:true})
  console.error('Checked '+method+' '+path)
}
try{
  for(const [file,expected]of Object.entries(manifest.files)){
    const path=file==='index.html'?'/':file==='production-wallet-origin-check.html'?'/production-wallet-origin-check':'/'+file
    const proof=path.startsWith('/production-wallet-origin-check')||path.startsWith('/assets/production-origin-check-')
    if(metadataOnly&&/\.(?:js|zip)$/.test(file))unverifiedBodies.push(path)
    else await check(path,{expected,proof})
    await check(path,{method:'HEAD',proof})
  }
  await check('/.well-known/webauthn',{expected:manifest.baseline['/.well-known/webauthn']})
  await check('/.well-known/webauthn',{method:'HEAD'})
  for(const path of ['/auth/landing','/api/wallet/noncustodial/config','/assets/stale-core.js','/start.mjs','/browser-wallet-handoff'])await check(path,{status:404})
  for(const path of ['/','/.well-known/webauthn'])await check(path,{method:'POST',status:405})
  const otherOrigins=[]
  assert.deepEqual(baseline.map(row=>row.origin).sort(),['https://antiety.com','https://preview.antiety.com'])
  for(const row of baseline){
    const {response,bytes}=await readPublic(row.origin+'/',{redirect:'error'})
    assert.equal(response.status,200);assert.equal(hash(bytes),row.sha256)
    otherOrigins.push({...row,status:200,unchanged:true})
  }
  const result={stage:'published-recovery-http-verification',status:'PASSED',scope:metadataOnly?'HEADERS_AND_SMALL_BODY_HASHES':'COMPLETE_BODY_HASHES_AND_HEADERS',unverifiedBodies,checks,otherOrigins,rootPublished:true,
    realWalletOrExportRead:false,transactionSubmitted:false,physicalHostedRecovery:'PENDING'}
  await writeFile(args[2],JSON.stringify(result,null,2)+'\n',{flag:'wx'})
  console.log(JSON.stringify({status:'PASSED',scope:result.scope,unverifiedBodies,walletHttpChecks:checks.length,otherOriginsUnchanged:otherOrigins.length,physicalHostedRecovery:'PENDING'}))
}catch(error){
  await writeFile(args[2],JSON.stringify({stage:'published-recovery-http-verification',status:'FAILED',completedChecks:checks,error:error.message},null,2)+'\n',{flag:'wx'})
  throw error
}
