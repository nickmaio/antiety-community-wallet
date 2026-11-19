import test from 'node:test'
import assert from 'node:assert/strict'
import {createRecoveryRpc} from '../src/rpc.js'
import {recoveryErrorText} from '../src/messages.js'

const urls=['https://first.synthetic.invalid/private-key','https://second.synthetic.invalid/private-key']
const tag='0x64',address='0x'+'1'.repeat(40),params=[address,tag]
const options={minimumIntervalMs:0,readRetryDelayMs:0}
function fixture({failures=1,rpcCode=-32001,wrongId=false,send=false}={}){
  const requests=[]
  let failed=0
  const rpc=createRecoveryRpc(urls,async(url,init)=>{
    const request=JSON.parse(init.body);requests.push({source:urls.indexOf(url),...request})
    const reject=(send||url===urls[0])&&failed++<failures
    const body={jsonrpc:'2.0',id:wrongId?request.id+1:request.id,...reject?
      {error:{code:rpcCode,message:'Secret provider URL https://synthetic.invalid/private-key'}}:{result:'0x0'}}
    return new Response(JSON.stringify(body),{status:200})
  },options)
  return {rpc,requests}
}

test('missing-resource reads retry the same source, method and block without retrying the other source',async()=>{
  const f=fixture({failures:2})
  assert.equal(await f.rpc.agree('eth_getBalance',params),'0x0')
  const first=f.requests.filter(row=>row.source===0),second=f.requests.filter(row=>row.source===1)
  assert.equal(first.length,3);assert.equal(second.length,1)
  assert.ok(first.every(row=>row.method==='eth_getBalance'&&JSON.stringify(row.params)===JSON.stringify(params)))
  assert.equal(new Set(f.requests.map(row=>row.id)).size,4)
  assert.ok(f.requests.every(row=>!row.method.includes('send')&&!row.method.includes('sign')))
})

test('a persistent missing resource stops after three reads with safe actionable diagnostics',async()=>{
  const f=fixture({failures:100})
  await assert.rejects(f.rpc.read(0,'eth_getCode',params),error=>{
    assert.equal(error.message,'RPC_REQUEST_FAILED');assert.equal(error.rpcCode,-32001)
    assert.equal(error.rpcRejection,true);assert.equal(error.method,'eth_getCode')
    const text=recoveryErrorText(error,'account chain check')
    assert.match(text,/Source 1: .*could not find the requested data/)
    assert.match(text,/HTTP 200, RPC -32001, request: eth_getCode, stage: account chain check/)
    assert.doesNotMatch(text,/private-key|https:|Secret/)
    return true
  })
  assert.equal(f.requests.length,3)
})

test('other errors, wrong response IDs and transaction sends are never retried',async()=>{
  for(const config of [{rpcCode:-32602},{wrongId:true},{send:true}]){
    const f=fixture({failures:100,...config})
    await assert.rejects(config.send?f.rpc.broadcastOnce('0x1234'):f.rpc.read(0,'eth_getCode',params))
    assert.equal(f.requests.length,1)
  }
  const receipt=fixture({failures:100})
  await assert.rejects(receipt.rpc.read(0,'eth_getTransactionReceipt',['0x'+'a'.repeat(64)]))
  assert.equal(receipt.requests.length,1,'Absent transaction evidence must remain uncertain')
})

test('source disagreement after a successful read retry still fails closed',async()=>{
  let first=0
  const calls=[]
  const rpc=createRecoveryRpc(urls,async(url,init)=>{
    const request=JSON.parse(init.body);calls.push(request)
    const failed=url===urls[0]&&first++===0
    return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,...failed?
      {error:{code:-32001}}:{result:url===urls[0]?'0x1':'0x2'}}),{status:200})
  },options)
  await assert.rejects(rpc.agree('eth_getBalance',params),/RPC_DISAGREEMENT/)
  assert.equal(calls.length,3)
})

test('diagnostics allow only fixed RPC method names and never echo arbitrary request text',()=>{
  const error=Object.assign(new Error('RPC_REQUEST_FAILED'),{source:'primary',rpcCode:-32001,
    rpcRejection:true,method:'https://private.invalid/private-key'})
  assert.doesNotMatch(recoveryErrorText(error),/private-key|https:|request:/)
})
