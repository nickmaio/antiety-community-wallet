import test from 'node:test'
import assert from 'node:assert/strict'
import {Interface} from 'ethers'
import {estimateRecoveryActivation,verifyRecoveryActivation} from '../src/activation.js'

const safeAddress='0x'+'1'.repeat(40),owner='0x'+'2'.repeat(40),to='0x'+'3'.repeat(40),hash='0x'+'a'.repeat(64)
const descriptor={safeAddress,recoveryOwner:owner},factory=new Interface(['function createProxyWithNonce(address,bytes,uint256) returns(address)'])
const state={deployed:false,baseFee:15n,eoaNonce:1n,blockNumber:100,blockHash:hash}
const execution={recoveryDeploymentCall:()=>({to,data:'0x1234'})}
const plan={action:'deploy',gasLimit:'1537223',maxFeePerGas:'1000000030',maxPriorityFeePerGas:'1000000000'}
function fixture({estimates=['0x127000','0x12c3d2'],response=factory.encodeFunctionResult('createProxyWithNonce',[safeAddress]),fork=false}={}){
  const calls=[]
  const rpc={read:async(source,method,params)=>{
    calls.push({source,method,params})
    if(method==='eth_estimateGas')return estimates[source]
    if(method==='eth_call')return response
    if(method==='eth_getBlockByNumber')return {number:'0x64',hash:fork?'0x'+'b'.repeat(64):hash}
    assert.fail('Unexpected method')
  }}
  return {rpc,calls,input:{rpc,execution,descriptor,state,plan}}
}

test('activation takes the greater bounded independent gas estimate with 25 percent margin',async()=>{
  const f=fixture({estimates:['0x'+(1200000n).toString(16),'0x'+(1229778n).toString(16)]})
  assert.equal(await estimateRecoveryActivation(f.input),'1537223')
  assert.deepEqual(f.calls.map(row=>row.source),[0,1])
  for(const call of f.calls){
    assert.equal(call.method,'eth_estimateGas');assert.equal(call.params[1],'0x64')
    assert.deepEqual(call.params[0],{to,data:'0x1234',from:owner,value:'0x0',nonce:'0x1',gas:'0x2dc6c0',
      maxFeePerGas:'0x'+(1000000030n).toString(16),maxPriorityFeePerGas:'0x3b9aca00'})
  }
})

test('malformed, excessive or insufficient-headroom activation estimates fail closed',async()=>{
  for(const estimate of ['0x0','0x012345','1200000','0x'+(3000001n).toString(16),'0x'+(2500000n).toString(16)]){
    const f=fixture({estimates:[estimate,estimate]})
    await assert.rejects(estimateRecoveryActivation(f.input),/ACTIVATION_GAS_INVALID/)
  }
})

test('activation simulation fixes reviewed gas, fees, nonce, calldata and pinned block on both sources',async()=>{
  const f=fixture();await verifyRecoveryActivation(f.input)
  const calls=f.calls.filter(row=>row.method==='eth_call');assert.equal(calls.length,2)
  for(const call of calls){assert.equal(call.params[0].gas,'0x'+BigInt(plan.gasLimit).toString(16));assert.equal(call.params[1],'0x64')}
  assert.equal(f.calls.filter(row=>row.method==='eth_getBlockByNumber').length,2)
  assert.ok(f.calls.every(row=>!row.method.includes('send')&&!row.method.includes('sign')))
})

test('simulation rejects wrong address, malformed return, unsafe gas and changed canonical block',async()=>{
  for(const response of ['0x',factory.encodeFunctionResult('createProxyWithNonce',[owner])]){
    await assert.rejects(verifyRecoveryActivation(fixture({response}).input),/SIMULATION_FAILED/)
  }
  await assert.rejects(verifyRecoveryActivation(fixture({fork:true}).input),/RPC_DISAGREEMENT/)
  for(const gasLimit of ['999999','3000001','-1']){
    const f=fixture();await assert.rejects(verifyRecoveryActivation({...f.input,plan:{...plan,gasLimit}}),/ACTIVATION_GAS_INVALID/)
    assert.equal(f.calls.length,0)
  }
})
