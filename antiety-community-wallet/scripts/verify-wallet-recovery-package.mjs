import assert from 'node:assert/strict'
import {readFile,readdir,realpath} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {request as httpRequest} from 'node:http'
import {join,resolve,sep} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {recoveryBrandContentType} from '../hosting/policy.js'

const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const allowed=/^(?:index\.html|README\.md|RECOVERY-BUILD\.json|_headers|start\.(?:mjs|ps1|cmd)|launcher\/server\.mjs|assets\/[A-Za-z0-9_-]+\.(?:js|css))$/
export async function verifyWalletRecoveryPackage(directory){
  const root=await realpath(resolve(directory))
  const manifest=JSON.parse(await readFile(join(root,'SHA256SUMS.json'),'utf8'))
  assert.equal(manifest.version,1)
  assert.equal(manifest.network,'Ethereum mainnet')
  assert.deepEqual(manifest.chainIds,[1])
  const actual=[]
  async function walk(dir,prefix=''){
    for(const entry of await readdir(dir,{withFileTypes:true})){
      assert.ok(!entry.isSymbolicLink(),'No package links')
      const name=prefix+entry.name
      if(entry.isDirectory())await walk(join(dir,entry.name),name+'/')
      else {assert.ok(entry.isFile());actual.push(name)}
    }
  }
  await walk(root)
  assert.deepEqual(actual.sort(),[...Object.keys(manifest.files),'SHA256SUMS.json'].sort(),'Manifest covers all files')
  for(const[name,expected]of Object.entries(manifest.files)){
    assert.ok(allowed.test(name)||recoveryBrandContentType('/'+name),name)
    const target=await realpath(join(root,name));assert.ok(target.startsWith(root+sep),'Bounded package path')
    assert.equal(hash(await readFile(target)),expected,name)
  }
  const build=JSON.parse(await readFile(join(root,'RECOVERY-BUILD.json'),'utf8'))
  assert.equal(build.network,manifest.network);assert.equal(build.slotCount,65536)
  assert.deepEqual(build.chainIds,[1])
  assert.equal(build.originalExportsSupported,true);assert.equal(build.antietyBackendRequired,false)
  assert.equal(build.antietyLoginIncluded,false);assert.equal(build.cryptoProvenanceSchema,'antiety-generation-build-v2')
  const project=fileURLToPath(new URL('../',import.meta.url))
  assert.equal(build.sourceCryptoSha256,hash(await readFile(join(project,'../shared/wallet/generated/walletGenerationCrypto.js'))))
  assert.equal(build.sourceCryptoMetadataSha256,hash(await readFile(join(project,'../shared/wallet/generated/walletGenerationCrypto.build.json'))))
  assert.ok(build.renderedModules.includes('shared/wallet/generated/walletGenerationCrypto.js'))
  assert.ok(!build.renderedModules.some(name=>/^web_client\/|^server\//.test(name)||/nonCustodialWalletApi\.js$/.test(name)))
  const html=await readFile(join(root,'index.html'),'utf8')
  assert.doesNotMatch(html,/<script\b[^>]*>\s*[^<\s]/i,'No inline script')
  assert.match(html,/<link\b[^>]*\brel="icon"[^>]*\bhref="\.\/favicon\.ico"/)
  const stylesheet=html.match(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="\.\/(assets\/[A-Za-z0-9_-]+\.css)"/)?.[1]
  assert.ok(stylesheet&&manifest.files[stylesheet],'The wallet stylesheet is linked and packaged')
  for(const match of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g))
    assert.match(match[1],/^\.\/(?:favicon\.ico|assets\/[A-Za-z0-9_-]+\.(?:js|css))$/,'Local page assets only')
  for(const name of ['favicon.ico','assets/antiety-logo.png'])
    assert.equal(manifest.files[name],hash(await readFile(join(project,'public',name))),name)
  // Import the verified packaged launcher, not the repository's server implementation.
  const {createRecoveryStaticServer}=await import(pathToFileURL(join(root,'launcher/server.mjs')).href)
  const server=await createRecoveryStaticServer(root,{port:0})
  let requests=0
  try{
    const url='http://127.0.0.1:'+server.address().port
    for(const name of ['index.html','favicon.ico',...Object.keys(manifest.files).filter(name=>name.startsWith('assets/'))]){
      const response=await fetch(url+'/'+name);requests++
      assert.equal(response.status,200);assert.equal(hash(new Uint8Array(await response.arrayBuffer())),manifest.files[name])
      const brandType=recoveryBrandContentType('/'+name)
      if(brandType)assert.equal(response.headers.get('content-type'),brandType)
      if(name===stylesheet)assert.match(response.headers.get('content-type'),/^text\/css\b/)
      assert.match(response.headers.get('content-security-policy'),/worker-src 'none'/)
      assert.doesNotMatch(response.headers.get('content-security-policy'),/unsafe-inline|unsafe-eval/)
      assert.equal(response.headers.get('cache-control'),'no-store')
      assert.equal(response.headers.get('cross-origin-opener-policy'),'same-origin')
    }
    const head=await fetch(url+'/',{method:'HEAD'});requests++
    assert.equal(head.status,200);assert.equal(await head.text(),'')
    for(const name of ['/api/wallet/noncustodial/config','/auth/session/me','/%2e%2e%2fREADME.md']){
      const response=await fetch(url+name);requests++;assert.equal(response.status,404)
    }
    const post=await fetch(url+'/',{method:'POST',body:'public synthetic text'});requests++;assert.equal(post.status,405)
    // Fetch may normalize/ignore Host; use Node HTTP to send the actual hostile header.
    const rebound=await new Promise((resolve,reject)=>{
      const req=httpRequest(url+'/',{headers:{Host:'untrusted.invalid'}},response=>{
        response.resume();response.on('end',()=>resolve(response.statusCode))
      })
      req.on('error',reject);req.setTimeout(2000,()=>req.destroy(Error('Host probe timed out')));req.end()
    });requests++;assert.equal(rebound,403)
  }finally{await new Promise(resolve=>server.close(resolve))}
  return {stage:'recovery-distribution-verification',status:'PASSED',manifestFiles:Object.keys(manifest.files).length,
    allPackageFilesVerified:true,qualifiedCryptoIncluded:true,backendOrLoginIncluded:false,localHttpRequests:requests,
    independentLocalLauncher:true,externalNetworkUsed:false,realWalletOrExportRead:false,transactionSubmitted:false}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{if(process.argv.length!==3)throw Error('Pass the built recovery directory');console.log(JSON.stringify(await verifyWalletRecoveryPackage(process.argv[2])))}
  catch(error){console.log(JSON.stringify({stage:'recovery-distribution-verification',status:'FAILED',
    code:error.code||'RECOVERY_PACKAGE_CHECK_FAILED',message:error.message,transactionSubmitted:false}));process.exitCode=1}
}
