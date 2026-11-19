import test from 'node:test'
import assert from 'node:assert/strict'
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb'
import {createMainnetGenerationProfile} from '../../shared/wallet/generated/walletGenerationCrypto.js'
import {discoverGenerationAccounts} from '../src/generationDiscovery.js'
import {createGenerationPagedScanJournal} from '../src/generationPagedScanJournal.js'

const root=new Uint8Array(32).fill(171),base=createMainnetGenerationProfile(),descriptor=base.describe(root)
const sourceHash='0x'+'6'.repeat(64),snapshot={chainId:1,blockNumber:100,blockHash:'0x'+'5'.repeat(64)}
const context={chainId:1,totalSlots:65536,generationId:descriptor.generationId,sourceHash}
function fixture(alter=()=>{}){
  const derived=[],profile={...base,account:(material,slot)=>{derived.push(slot);return base.account(material,slot)}}
  const indexedDB=new IDBFactory(),journal=createGenerationPagedScanJournal({indexedDB,keyRange:IDBKeyRange,chainId:1})
  const reader={pageSize:48,sourceHash,getSnapshot:async()=>snapshot,verifySnapshot:async()=>true,verifyBlock:async()=>true,
    verifyDeployed:()=>assert.fail('No deployed fixture accounts'),readPage:async page=>{
      const rows=page.map(account=>({nativeAtomic:'0',entryPointDepositAtomic:'0',tokenAtomic:account.slot===143?'1000000':'0',
        codeHash:'0x'+'0'.repeat(64)}))
      const result=[structuredClone(rows),structuredClone(rows)];alter(result);return result
    }}
  const discover=()=>discoverGenerationAccounts({root,descriptor,profile,reader,journal,search:{guided:true},timeoutMs:30000})
  return {derived,journal,discover}
}
test('USDT-only accounts reset the empty gap and survive encrypted restart without deriving the saved prefix',async()=>{
  const f=fixture(),first=await f.discover()
  assert.equal(first.scannedSlots,288);assert.equal(first.pauseReason,'EMPTY_GAP');assert.equal(first.nativeAtomic,'0')
  assert.equal(first.tokenAtomic,'1000000');assert.equal(first.accounts.find(a=>a.slot===143).tokenAtomic,'1000000')
  f.derived.length=0
  const opened=await f.journal.open(root,base.descriptorHash(descriptor),context),saved=await opened.read()
  assert.equal(saved.scannedSlots,288);assert.equal(saved.tokenAtomic,'1000000');assert.equal(f.derived.length,0);opened.close()
  const second=await f.discover()
  assert.equal(second.resumedAt,288);assert.equal(second.scannedSlots,432);assert.equal(second.tokenAtomic,'1000000')
  assert.ok(f.derived.every(slot=>slot>=288))
})
test('missing or disagreeing token evidence cannot advance the encrypted recovery checkpoint',async()=>{
  for(const alter of [rows=>delete rows[0][0].tokenAtomic,rows=>{rows[1][0].tokenAtomic='1'}]){
    const f=fixture(alter)
    await assert.rejects(f.discover(),/GENERATION_RECOVERY_RPC_(INVALID|DISAGREEMENT)/)
    const opened=await f.journal.open(root,base.descriptorHash(descriptor),context),saved=await opened.read()
    assert.equal(saved.scannedSlots,0);assert.equal(saved.tokenAtomic,'0');opened.close()
  }
})
