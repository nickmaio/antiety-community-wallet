import test from 'node:test'
import assert from 'node:assert/strict'
import {createCompatibleRecoveryWorker,relatedOriginsDocument} from '../hosting/compatible-worker.js'
import {recoveryHostingHeaders} from '../hosting/policy.js'

const files=['index.html','assets/index-recovery.js','wallet-recovery-ethereum.zip',
  'production-wallet-origin-check.html','assets/production-origin-check-test.js',
  ...['assetlinks.json','assetlinks.antiety-development.json','apple-app-site-association'].map(name=>'.well-known/'+name)]
const worker=createCompatibleRecoveryWorker(files)
function fixture(){
  const requests=[]
  const env={ASSETS:{fetch:async request=>{
    requests.push(new URL(request.url))
    return new Response('static fixture',{headers:{'Content-Type':'text/html'}})
  }}}
  return {requests,env}
}
const request=(path,method='GET')=>new Request('https://wallet.antiety.com'+path,{method})

test('recovery root retains isolated headers and removed handoff URLs return 404',async()=>{
  const f=fixture(),root=await worker.fetch(request('/?old=bookmark'),f.env)
  assert.equal(f.requests.at(-1).pathname,'/index.html');assert.equal(f.requests.at(-1).search,'')
  assert.equal(root.headers.get('Cross-Origin-Opener-Policy'),'same-origin')
  assert.equal(root.headers.get('Content-Security-Policy'),recoveryHostingHeaders['Content-Security-Policy'])
  for(const path of ['/browser-wallet-handoff','/browser-wallet-handoff/','/assets/wallet-handoff-check.js','/wallet-recovery-sepolia.zip'])
    assert.equal((await worker.fetch(request(path),f.env)).status,404)
  assert.equal(f.requests.length,1)
})
test('related-origin metadata retains preview and production with no asset/API read',async()=>{
  const f=fixture(),result=await worker.fetch(request('/.well-known/webauthn'),f.env)
  assert.equal(await result.text(),relatedOriginsDocument)
  assert.deepEqual(JSON.parse(relatedOriginsDocument),{origins:['https://preview.antiety.com','https://antiety.com']})
  assert.equal(result.headers.get('Content-Type'),'application/json');assert.equal(f.requests.length,0)
  assert.equal(await (await worker.fetch(request('/.well-known/webauthn','HEAD'),f.env)).text(),'')
})
test('production origin proof keeps its isolated CSP and only serves staged assets',async()=>{
  const f=fixture()
  for(const path of ['/production-wallet-origin-check','/production-wallet-origin-check/','/assets/production-origin-check-test.js']){
    const result=await worker.fetch(request(path+'?ignored=1'),f.env)
    assert.equal(result.status,200);assert.match(result.headers.get('Content-Security-Policy'),/connect-src 'none'/)
    assert.equal(result.headers.get('Cross-Origin-Opener-Policy'),'unsafe-none');assert.equal(f.requests.at(-1).search,'')
  }
  const before=f.requests.length
  assert.equal((await worker.fetch(request('/assets/production-origin-check-unknown.js'),f.env)).status,404)
  assert.equal((await worker.fetch(request('/production-wallet-origin-check','POST'),f.env)).status,405)
  assert.equal(f.requests.length,before)
})
test('unknown and retired app/proof/API paths never reach the asset binding',async()=>{
  const f=fixture()
  for(const path of ['/auth/login','/finance','/api/wallet/noncustodial/config','/browser-wallet-origin-check','/assets/old-core.js','/assets/wallet-handoff-unknown.js','/browser-wallet-handoff.html','/start.mjs']){
    assert.equal((await worker.fetch(request(path),f.env)).status,404,path)
  }
  assert.equal(f.requests.length,0)
})
test('all routes reject mutations and preserve HEAD semantics',async()=>{
  const f=fixture()
  for(const path of ['/','/.well-known/webauthn','/assets/index-recovery.js']){
    for(const method of ['POST','PUT','DELETE','OPTIONS'])assert.equal((await worker.fetch(request(path,method),f.env)).status,405)
    assert.equal(await (await worker.fetch(request(path,'HEAD'),f.env)).text(),'')
  }
})
test('device associations and downloadable recovery remain reachable',async()=>{
  const f=fixture()
  for(const path of files.filter(file=>file.startsWith('.well-known/'))){
    const result=await worker.fetch(request('/'+path),f.env)
    assert.equal(result.status,200);assert.equal(result.headers.get('Content-Type'),'application/json')
  }
  const ethereum=await worker.fetch(request('/wallet-recovery-ethereum.zip'),f.env)
  assert.equal(ethereum.headers.get('Content-Disposition'),'attachment; filename="wallet-recovery-ethereum.zip"')
})
