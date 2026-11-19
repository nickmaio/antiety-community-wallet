import test from 'node:test'
import assert from 'node:assert/strict'
import {IDBFactory} from 'fake-indexeddb'
import {inspectRecoveryStorage,createRecoveryStorageProbe} from '../src/storageDiagnostic.js'

async function populate(indexedDB,name,store,values){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(name,1)
    request.onupgradeneeded=()=>request.result.createObjectStore(store)
    request.onerror=()=>reject(request.error)
    request.onsuccess=()=>{
      const db=request.result,transaction=db.transaction(store,'readwrite')
      values.forEach((value,i)=>transaction.objectStore(store).put(value,i))
      transaction.oncomplete=()=>{db.close();resolve()}
      transaction.onerror=()=>{db.close();reject(transaction.error)}
    }
  })
}

test('storage inspection counts raw journal entries without parsing or exposing record contents',async()=>{
  const indexedDB=new IDBFactory()
  await populate(indexedDB,'antiety-independent-generation-mainnet-recovery-v1','wallets',[{invalid:'Sensitive synthetic contents'},'Other private fixture'])
  await populate(indexedDB,'unrelated-private-database','secrets',['Must not inspect'])
  const result=await inspectRecoveryStorage({indexedDB,origin:'http://127.0.0.1:18747',storage:{persisted:async()=>false},locks:{request(){}}})
  assert.equal(result.journals.generation.recordCount,2);assert.deepEqual(Object.keys(result.journals),['generation'])
  assert.equal(result.origin,'http://127.0.0.1:18747');assert.equal(result.persistentStorage,false)
  assert.equal(result.recordsRead,false);assert.equal(result.recordsChanged,false);assert.equal(result.networkUsed,false)
  assert.doesNotMatch(JSON.stringify(result),/Sensitive|Other private|unrelated-private|Must not inspect/)
  assert.deepEqual((await indexedDB.databases()).map(row=>row.name).sort(),['antiety-independent-generation-mainnet-recovery-v1','unrelated-private-database'])
})

test('an empty browser stays empty and non-Mainnet storage is ignored',async()=>{
  const indexedDB=new IDBFactory()
  const empty=await inspectRecoveryStorage({indexedDB});assert.equal(empty.journals.generation.present,false)
  assert.deepEqual(await indexedDB.databases(),[])
  await populate(indexedDB,'antiety-independent-recovery-v1','wallets',[{synthetic:true}])
  const mainnet=await inspectRecoveryStorage({indexedDB})
  assert.deepEqual(Object.keys(mainnet.journals),['generation'])
  assert.equal(mainnet.journals.generation.present,false)
})

test('missing stores and denied or stalled database access cannot be reported as zero records',async()=>{
  const indexedDB=new IDBFactory();await populate(indexedDB,'antiety-independent-generation-mainnet-recovery-v1','other',[])
  const result=await inspectRecoveryStorage({indexedDB});assert.equal(result.journals.generation.storePresent,false)
  assert.equal(result.journals.generation.recordCount,null)
  await assert.rejects(inspectRecoveryStorage({indexedDB:{databases:async()=>{throw Error('Private provider text')}}}),/RECOVERY_STORAGE_DIAGNOSTIC_FAILED/)
  await assert.rejects(inspectRecoveryStorage({indexedDB:{databases:()=>new Promise(()=>{})},timeoutMs:10}),/RECOVERY_STORAGE_DIAGNOSTIC_FAILED/)
})

test('the synthetic probe survives page reconstruction without creating or reading wallet journals',async()=>{
  const indexedDB=new IDBFactory(),values=new Map(),localStorage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)}
  const first=createRecoveryStorageProbe({indexedDB,localStorage,pageId:'page-1',randomId:()=> 'synthetic-marker'})
  assert.equal((await first.check()).status,'MARKER_MISSING_OR_CHANGED');assert.deepEqual(await indexedDB.databases(),[])
  assert.equal((await first.save()).status,'SAVED_THIS_PAGE_RELOAD_TO_CHECK')
  const second=createRecoveryStorageProbe({indexedDB,localStorage,pageId:'page-2'})
  const result=await second.check();assert.equal(result.status,'PASSED_AFTER_RELOAD')
  assert.equal(result.walletRecordsRead,false);assert.equal(result.walletRecordsChanged,false)
  assert.deepEqual((await indexedDB.databases()).map(row=>row.name),['antiety-recovery-storage-probe-v1'])
  assert.doesNotMatch(JSON.stringify(result),/synthetic-marker|page-1|page-2/)
})

test('the probe distinguishes lost IndexedDB, lost local storage and a changed marker',async()=>{
  const indexedDB=new IDBFactory(),values=new Map(),localStorage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)}
  await createRecoveryStorageProbe({indexedDB,localStorage,pageId:'first',randomId:()=> 'fixture'}).save()
  const lostDb=await createRecoveryStorageProbe({indexedDB:new IDBFactory(),localStorage,pageId:'second'}).check()
  assert.equal(lostDb.indexedDbMarkerPresent,false);assert.equal(lostDb.localStorageMarkerPresent,true);assert.equal(lostDb.markersMatch,false)
  values.clear();const lostLocal=await createRecoveryStorageProbe({indexedDB,localStorage,pageId:'second'}).check()
  assert.equal(lostLocal.indexedDbMarkerPresent,true);assert.equal(lostLocal.localStorageMarkerPresent,false);assert.equal(lostLocal.markersMatch,false)
  localStorage.setItem('antiety.recovery.synthetic-storage-probe.v1','changed')
  assert.equal((await createRecoveryStorageProbe({indexedDB,localStorage,pageId:'third'}).check()).markersMatch,false)
})

test('the synthetic probe times out or reports denied storage without exposing errors',async()=>{
  const stalled=createRecoveryStorageProbe({indexedDB:{databases:()=>new Promise(()=>{})},pageId:'fixture',timeoutMs:10})
  await assert.rejects(stalled.check(),/RECOVERY_STORAGE_PROBE_FAILED/)
  const denied=createRecoveryStorageProbe({indexedDB:new IDBFactory(),pageId:'fixture',randomId:()=> 'marker',
    localStorage:{setItem:()=>{throw Error('Private fixture')},getItem:()=>null}})
  await assert.rejects(denied.save(),/RECOVERY_STORAGE_PROBE_FAILED/)
})
