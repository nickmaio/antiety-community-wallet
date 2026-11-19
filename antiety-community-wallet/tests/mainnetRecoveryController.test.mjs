import test from 'node:test'
import assert from 'node:assert/strict'
import {IDBFactory} from 'fake-indexeddb'
import {Interface,parseEther,keccak256} from 'ethers'
import {createGenerationRecoveryController} from '../src/generationController.js'
import {createGenerationRecoveryExecution} from '../src/generationExecution.js'
import {createGenerationRecoveryCodec} from '../../shared/wallet/generation/recovery.js'
import {createRecoveryJournal} from '../src/journal.js'
import {recoverySelectedAsset,recoveryPlanInput} from '../src/networkPresentation.js'
import {inspectRecoveryStorage} from '../src/storageDiagnostic.js'

// Public synthetic root. No real file, RPC, Antiety API, bundler or funds.
const adapter=createGenerationRecoveryExecution({network:'ethereum-mainnet'}),profile=adapter.profileFor(),execution=adapter.generationExecution
const root=new Uint8Array(32).fill(197),generation=profile.describe(root),child=profile.privateAccount(root,generation,0)
const codec=createGenerationRecoveryCodec({profile}),phrase='Public synthetic recovery UI phrase only'
const backup=await codec.exportBackup({root,passphrase:phrase}),usdt=recoverySelectedAsset(1,'erc20')
const recipient='0x'+'7'.repeat(40),blockHash='0x'+'8'.repeat(64),entry=new Interface(['function balanceOf(address) view returns(uint256)'])
const sources=['https://first.synthetic.invalid','https://second.synthetic.invalid']
const locks={request:async(_name,_options,work)=>work({})}
test.after(()=>{root.fill(0);child.privateKey.fill(0)})

function fixture(){
  const indexedDB=new IDBFactory(),name='antiety-independent-generation-mainnet-recovery-v1',makeJournal=()=>createRecoveryJournal({indexedDB,locks,
    databaseName:name,chainId:1,assertRecord:adapter.generationRecordCodec.assertRecoveryRecord})
  let journal=makeJournal(),reportedChain='0x1',receiptReads=0,broadcasts=0
  const rpc={state:async(_descriptor,options)=>{
    if(options?.asset)assert.equal(options.asset.chainId,1)
    return {chainId:1,deployed:true,safeBalance:parseEther('2'),recoveryBalance:parseEther('1'),tokenBalance:2000000n,
      eoaNonce:0n,pendingEoaNonce:0n,safeNonce:0n,baseFee:1n,blockNumber:100,blockHash}
  },agree:async(method,params)=>{
    if(method==='eth_chainId')return reportedChain
    assert.equal(method,'eth_call')
    if(params[0].to.toLowerCase()===generation.stack.entryPoint.toLowerCase())return entry.encodeFunctionResult('balanceOf',[1000n])
    const row=await journal.read(child.safeAddress)
    return execution.safeInterface.encodeFunctionResult('getTransactionHash',[execution.recoverySafeHash(row.plan)])
  },broadcastOnce:async raw=>{broadcasts++;return keccak256(raw)},read:async(_source,method)=>{
    assert.equal(method,'eth_getTransactionReceipt');receiptReads++;return null
  }}
  const make=(configured=true)=>{
    const flow=createGenerationRecoveryController({network:'ethereum-mainnet',journal,
      rpcFactory:()=>rpc,readerFactory:()=>({verifyDeployed:async()=>true,verifyBlock:async()=>true})})
    if(configured)flow.setRpc(sources)
    return flow
  }
  return {make,indexedDB,name,setChain:value=>{reportedChain=value},counts:()=>({receiptReads,broadcasts}),
    reopen(){journal=makeJournal();return make(false)},journal:()=>journal}
}

test('mainnet controller persists exact token reviews and signed status, then reconciles after restart on chain 1 only',async t=>{
  const f=fixture(),flow=f.make();t.after(()=>flow.lock())
  assert.equal(flow.chainId,1);await flow.unlock(backup,phrase);await flow.unlockKnownAccount(0,child.safeAddress)
  const prepared=await flow.prepare({recipient,amount:'1.000001',asset:usdt})
  assert.equal(prepared.plan.amountAtomic,'1000001');assert.deepEqual(prepared.plan.asset,usdt)
  const refreshed=await flow.prepare(recoveryPlanInput(prepared.plan))
  assert.equal(refreshed.plan.amountAtomic,'1000001');assert.deepEqual(refreshed.plan.asset,usdt)
  const sent=await flow.submit(refreshed.plan.reviewHash,true)
  assert.equal(sent.status,'SUBMITTED');assert.equal(f.counts().broadcasts,1)
  const restarted=f.reopen();t.after(()=>restarted.lock())
  const saved=await restarted.openSaved(child.safeAddress)
  assert.equal(saved.transactionHash,sent.transactionHash);assert.deepEqual(saved.plan.asset,usdt)
  assert.equal(restarted.isUnlocked(),false);assert.equal(f.counts().receiptReads,0)
  restarted.setRpc(sources)
  f.setChain('0xaa36a7');await assert.rejects(restarted.reconcile(),{code:'WRONG_NETWORK'})
  assert.equal(f.counts().receiptReads,0)
  f.setChain('0x1');const checked=await restarted.reconcile()
  assert.equal(checked.status,'UNKNOWN');assert.equal(checked.transactionHash,sent.transactionHash)
  assert.equal(f.counts().receiptReads,2);assert.equal(f.counts().broadcasts,1)
  const db=await new Promise((resolve,reject)=>{const request=f.indexedDB.open(f.name,1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})
  const keys=await new Promise(resolve=>{db.transaction('wallets').objectStore('wallets').getAllKeys().onsuccess=event=>resolve(event.target.result)})
  assert.deepEqual(keys,['1:'+child.safeAddress.toLowerCase()]);db.close()
  const diagnostic=await inspectRecoveryStorage({indexedDB:f.indexedDB,chainId:1})
  assert.equal(diagnostic.chainId,1);assert.equal(diagnostic.journals.generation.recordCount,1)
  assert.deepEqual(Object.keys(diagnostic.journals),['generation'])
  assert.equal((await inspectRecoveryStorage({indexedDB:f.indexedDB})).journals.generation.present,true)
  assert.equal(diagnostic.recordsRead,false)
})

test('network mismatches reject before recovery signing or transport, with the original ciphertext retained',async t=>{
  const f=fixture(),main=f.make()
  t.after(()=>main.lock())
  assert.throws(()=>createGenerationRecoveryController({network:'sepolia'}),{code:'WRONG_NETWORK'})
  const packet=JSON.parse(backup)
  packet.descriptor.chainId=11155111
  const foreign=JSON.stringify(packet)
  await assert.rejects(main.unlock(foreign,phrase));assert.equal(main.isUnlocked(),false)
  assert.equal(f.counts().broadcasts,0)
  await main.unlock(backup,phrase);assert.equal(main.descriptor().generationId,generation.generationId)
})

test('checking the parent after restart keeps an unsigned replacement review when no receipt is available',async t=>{
  const f=fixture(),flow=f.make();t.after(()=>flow.lock())
  await flow.unlock(backup,phrase);await flow.unlockKnownAccount(0,child.safeAddress)
  const prepared=await flow.prepare({recipient,amount:'1.000001',asset:usdt})
  const sent=await flow.submit(prepared.plan.reviewHash,true)
  await flow.unlock(backup,phrase);await flow.resumeAccount(child.safeAddress)
  const replacement=await flow.prepare({replacement:true})
  assert.equal(replacement.plan.replacesTransactionHash,sent.transactionHash)
  const restarted=f.reopen();t.after(()=>restarted.lock())
  await restarted.openSaved(child.safeAddress);restarted.setRpc(sources)
  const checked=await restarted.reconcile()
  assert.equal(checked.status,'PREPARED');assert.equal(checked.plan.reviewHash,replacement.plan.reviewHash)
  assert.deepEqual(f.counts(),{receiptReads:2,broadcasts:1})
})
