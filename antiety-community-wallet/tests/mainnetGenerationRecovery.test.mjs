import test from 'node:test'
import assert from 'node:assert/strict'
import * as ethers from 'ethers'
import {createGenerationRecoveryExecution} from '../src/generationExecution.js'

// Public synthetic key material, never fund. No transport, passkey or backend is present.
const adapter=createGenerationRecoveryExecution({network:'ethereum-mainnet'}),profile=adapter.profileFor()
const root=new Uint8Array(32).fill(117),generation=profile.describe(root),child=profile.privateAccount(root,generation,63)
const descriptor=adapter.generationAccountDescriptor(generation,child),execution=adapter.generationExecution
const recipient=ethers.getAddress('0x'+'7'.repeat(40)),usdt={chainId:1,kind:'erc20',contractAddress:'0xdac17f958d2ee523a2206206994597c13d831ec7'}
const token=new ethers.Interface(['function transfer(address,uint256)','event Transfer(address indexed from,address indexed to,uint256 value)'])
const state={chainId:1,deployed:true,safeBalance:ethers.parseEther('2'),tokenBalance:2000000n,recoveryBalance:ethers.parseEther('1'),
  entryPointDeposit:0n,eoaNonce:0n,pendingEoaNonce:0n,safeNonce:0n,baseFee:1n,blockNumber:100,blockHash:'0x'+'5'.repeat(64)}
const now=1000000
test.after(()=>{root.fill(0);child.privateKey.fill(0)})
function plan(options={}){return execution.prepareRecoveryPlan({descriptor,state,asset:usdt,recipient,amount:'1.000001',now,...options})}
async function signed(input=plan()){
  const bytes=await execution.signRecoveryTransaction({privateKey:ethers.hexlify(child.privateKey),descriptor,plan:input,state,reviewHash:input.reviewHash,now})
  return {version:1,descriptor,plan:input,status:'SIGNED',...bytes}
}
test('mainnet original-export owner recovers exact USDT with ETH paid separately by the recovery EOA',async()=>{
  const input=plan({state:{...state,safeBalance:0n}})
  assert.equal(input.chainId,1);assert.equal(input.amountAtomic,'1000001');assert.deepEqual(input.asset,usdt)
  const record=await signed(input),tx=execution.assertSignedRecoveryRecord(record)
  assert.equal(tx.chainId,1n);assert.equal(tx.from,descriptor.recoveryOwner);assert.equal(tx.value,0n);assert.equal(tx.to,descriptor.safeAddress)
  const call=execution.safeInterface.decodeFunctionData('execTransaction',tx.data)
  assert.equal(call[0],ethers.getAddress(usdt.contractAddress));assert.equal(call[1],0n)
  const transfer=token.decodeFunctionData('transfer',call[2]);assert.equal(transfer[0],recipient);assert.equal(transfer[1],1000001n)
  adapter.generationRecordCodec.assertRecoveryRecord(record)
  assert.throws(()=>adapter.assertGenerationAccountDescriptor({...descriptor,chainId:'11155111'}))
})
test('mainnet native recovery retains ETH units and is independent of the historical testnet transfer cap',()=>{
  const native=plan({asset:{chainId:1,kind:'native',contractAddress:null},amount:'1'})
  assert.equal(native.amountAtomic,ethers.parseEther('1').toString())
  assert.throws(()=>plan({amount:'0.0000001'}),{code:'INVALID_PAYMENT'})
  assert.throws(()=>plan({state:{...state,tokenBalance:0n}}),{code:'INSUFFICIENT_TOKEN_BALANCE'})
  assert.throws(()=>plan({state:{...state,recoveryBalance:0n}}),{code:'RECOVERY_OWNER_NEEDS_GAS'})
  assert.throws(()=>plan({asset:{...usdt,contractAddress:'0x'+'4'.repeat(40)}}),{code:'INVALID_RECOVERY_ASSET'})
  assert.throws(()=>plan({state:{...state,chainId:11155111}}),{code:'WRONG_NETWORK'})
})
test('fee replacement preserves the token, exact amount, destination and both nonces',async()=>{
  const parent={...await signed(),status:'UNKNOWN'}
  const replacement=execution.prepareRecoveryReplacement({parent,descriptor,state,now:now+1})
  assert.deepEqual(replacement.asset,usdt);assert.equal(replacement.amountAtomic,'1000001');assert.equal(replacement.recipient,recipient)
  const altered={...replacement,asset:{chainId:1,kind:'native',contractAddress:null}}
  assert.throws(()=>execution.assertRecoveryReplacement(altered,parent),{code:'REPLACEMENT_MUST_PRESERVE_PAYMENT_AND_NONCES'})
})
async function evidence(success=true){
  const record=await signed(),blockHash='0x'+'b'.repeat(64),transactionHash=record.transactionHash
  const log=(address,encoded,index)=>({address,...encoded,blockHash,transactionHash,blockNumber:'0x65',logIndex:'0x'+index.toString(16),removed:false})
  const logs=[...(success?[log(ethers.getAddress(usdt.contractAddress),token.encodeEventLog('Transfer',[descriptor.safeAddress,recipient,1000001n]),0)]:[]),
    log(descriptor.safeAddress,execution.safeInterface.encodeEventLog(success?'ExecutionSuccess':'ExecutionFailure',[record.safeTransactionHash,0]),1)]
  const receipt={transactionHash,blockHash,blockNumber:'0x65',status:'0x1',logs}
  return {record,receipts:[structuredClone(receipt),structuredClone(receipt)],blocks:[0,1].map(()=>({number:'0x65',hash:blockHash})),
    finalizedHeads:[0,1].map(()=>({number:'0x66',hash:'0x'+'c'.repeat(64)}))}
}
test('owner recovery requires real token-transfer evidence and common finality, including execution failure',async()=>{
  const e=await evidence()
  assert.equal(execution.verifyRecoveryReceipts(e).status,'FINALIZED')
  e.receipts[0].logs.shift()
  assert.throws(()=>execution.verifyRecoveryReceipts(e),{code:'TOKEN_EXECUTION_NOT_VERIFIED'})
  assert.equal(execution.verifyRecoveryReceipts(await evidence(false)).status,'FAILED_FINALIZED')
  const disagreement=await evidence();disagreement.finalizedHeads[1].hash='0x'+'d'.repeat(64)
  assert.equal(execution.verifyRecoveryReceipts(disagreement).status,'FINALITY_PENDING')
})
