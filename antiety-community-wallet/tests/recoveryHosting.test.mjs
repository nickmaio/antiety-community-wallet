import test from 'node:test'
import assert from 'node:assert/strict'
import worker from '../hosting/worker.js'
import {recoveryHostingHeaders} from '../hosting/policy.js'

const requests=[],env={ASSETS:{fetch:async request=>{
  requests.push({path:new URL(request.url).pathname,query:new URL(request.url).search})
  return new Response('public static fixture',{headers:{'Content-Type':'application/octet-stream'}})
}}}
test('recovery root serves only its static entry with strict recovery policy and no inline script allowance',async()=>{
  const response=await worker.fetch(new Request('https://wallet.antiety.com/?diagnostic=ignored'),env)
  assert.deepEqual(requests.at(-1),{path:'/index.html',query:''})
  for(const [key,value]of Object.entries(recoveryHostingHeaders))assert.equal(response.headers.get(key),value)
  assert.match(response.headers.get('Content-Security-Policy'),/connect-src https:/)
  assert.doesNotMatch(response.headers.get('Content-Security-Policy'),/unsafe-inline|unsafe-eval/)
})
test('core app/auth/api/proof and arbitrary document routes cannot fall back to recovery',async()=>{
  for(const path of ['/finance','/app','/auth/login','/people','/api/wallet/noncustodial/config','/wallet-root-vault-proof','/assets/arbitrary.html','/assets/arbitrary.png']){
    const before=requests.length,response=await worker.fetch(new Request('https://wallet.antiety.com'+path),env)
    assert.equal(response.status,404);assert.equal(requests.length,before)
  }
})
test('recovery hosting accepts no uploads, RPC proxy requests or mutation methods',async()=>{
  for(const path of ['/','/api','/assets/index-test.js']){
    const before=requests.length,response=await worker.fetch(new Request('https://wallet.antiety.com'+path,{method:'POST',body:'synthetic'}),env)
    assert.equal(response.status,405);assert.equal(response.headers.get('Allow'),'GET, HEAD');assert.equal(requests.length,before)
  }
})
test('device association paths and JSON MIME survive the recovery publication; HEAD has no body',async()=>{
  for(const file of ['assetlinks.json','assetlinks.antiety-development.json','apple-app-site-association']){
    const path='/.well-known/'+file,response=await worker.fetch(new Request('https://wallet.antiety.com'+path,{method:'HEAD'}),env)
    assert.equal(requests.at(-1).path,path);assert.equal(response.headers.get('Content-Type'),'application/json');assert.equal(await response.text(),'')
  }
})
test('downloadable recovery package, checksums and assets are served explicitly without executing launchers',async()=>{
  for(const path of ['/wallet-recovery-ethereum.zip','/wallet-recovery-ethereum.zip.sha256','/SHA256SUMS.json','/RECOVERY-BUILD.json','/assets/index-test.js','/assets/index-test.css']){
    const response=await worker.fetch(new Request('https://wallet.antiety.com'+path),env)
    assert.equal(response.status,200);assert.equal(requests.at(-1).path,path)
    if(path.endsWith('.zip'))assert.match(response.headers.get('Content-Disposition'),/^attachment;/)
  }
  for(const path of ['/start.mjs','/launcher/server.mjs','/wallet-recovery-sepolia.zip'])assert.equal((await worker.fetch(new Request('https://wallet.antiety.com'+path),env)).status,404)
})
