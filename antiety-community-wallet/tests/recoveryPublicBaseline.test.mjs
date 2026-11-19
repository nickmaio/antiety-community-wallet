import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {verifyRecoveryPublicBaseline} from '../scripts/lib/recovery-public-baseline.mjs'

const hash=s=>createHash('sha256').update(s).digest('hex')
test('public baseline retries a reset and records only verified bodies',async()=>{
  let calls=0
  const result=await verifyRecoveryPublicBaseline({'/safe':hash('body')},{fetchImpl:async(url,options)=>{
    assert.equal(url,'https://wallet.antiety.com/safe');assert.equal(options.redirect,'error')
    if(++calls===1)throw Object.assign(new TypeError('private error text'),{cause:{code:'ECONNRESET'}})
    return new Response('body')
  }})
  assert.equal(result.status,'PASSED');assert.equal(calls,2);assert.equal(result.checks.length,1)
})
test('mismatched bodies and HTTP failures never pass or retry',async()=>{
  let calls=0
  let result=await verifyRecoveryPublicBaseline({'/safe':hash('expected')},{fetchImpl:async()=>{calls++;return new Response('different')}})
  assert.equal(result.failure.category,'hash-mismatch');assert.equal(calls,1)
  result=await verifyRecoveryPublicBaseline({'/safe':hash('expected')},{fetchImpl:async()=>{calls++;return new Response('error',{status:503})}})
  assert.equal(result.failure.category,'http-status');assert.equal(calls,2)
})
test('persistent network resets fail closed with a path and no provider message',async()=>{
  const result=await verifyRecoveryPublicBaseline({'/safe':hash('expected')},{fetchImpl:async()=>{
    throw Object.assign(new TypeError('secret upstream detail'),{cause:{code:'ECONNRESET',message:'private'}})
  }})
  assert.equal(result.status,'FAILED');assert.deepEqual(result.failure,{path:'/safe',category:'transport-error',errorName:'TypeError',causeCode:'ECONNRESET'})
  assert.doesNotMatch(JSON.stringify(result),/secret|private/)
})
test('failure retains earlier verified paths and never reports success',async()=>{
  const baseline={'/first':hash('good'),'/second':hash('expected')}
  const result=await verifyRecoveryPublicBaseline(baseline,{fetchImpl:async url=>
    url.endsWith('/first')?new Response('good'):new Response('different')})
  assert.equal(result.status,'FAILED');assert.equal(result.failure.path,'/second')
  assert.deepEqual(result.checks,[{path:'/first',status:200,sha256:hash('good')}])
})
test('invalid baseline paths cannot redirect the verifier to another host',async()=>{
  let calls=0
  const result=await verifyRecoveryPublicBaseline({'/../private':hash('x')},{fetchImpl:async()=>{calls++}})
  assert.equal(result.failure.category,'invalid-baseline');assert.equal(calls,0)
})
