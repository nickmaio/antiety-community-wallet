import test from 'node:test'
import assert from 'node:assert/strict'
import {IDBFactory,forceCloseDatabase} from 'fake-indexeddb'
import {createRecoveryJournal} from '../src/journal.js'
import {submitRecoveryAttempt} from '../../shared/wallet/recoverySubmission.js'

const address='0x'+'1'.repeat(40),reviewHash='0x'+'2'.repeat(64)
const initial={version:1,descriptor:{safeAddress:address},plan:{reviewHash},status:'PREPARED'}
const locks={request:async(_name,_options,task)=>task({})}
const tick=()=>new Promise(resolve=>setImmediate(resolve))
function fixture({failOpen=false,abortStatus=null}={}){
  const indexedDB=new IDBFactory(),connections=[];let opens=0,aborted=false
  const factory={open(...args){
    opens++
    if(failOpen&&opens===1){const request={};queueMicrotask(()=>request.onerror());return request}
    const request=indexedDB.open(...args)
    request.addEventListener('success',()=>{
      const db=request.result;connections.push(db)
      if(abortStatus){
        const transaction=db.transaction.bind(db)
        db.transaction=(...args)=>{
          const tx=transaction(...args),objectStore=tx.objectStore.bind(tx)
          tx.objectStore=name=>{
            const store=objectStore(name),put=store.put.bind(store)
            store.put=(value,...rest)=>{
              const request=put(value,...rest)
              if(value.status===abortStatus&&!aborted)request.addEventListener('success',()=>{aborted=true;tx.abort()})
              return request
            }
            return store
          }
          return tx
        }
      }
    })
    return request
  }}
  const journal=createRecoveryJournal({indexedDB:factory,locks,databaseName:'synthetic-recovery-journal-lifecycle',assertRecord:value=>value})
  return {journal,connections,opens:()=>opens,save:row=>journal.withRecord(address,({save})=>save(row))}
}

test('forced browser connection closure reopens the same committed journal instead of retaining a dead handle',async()=>{
  const f=fixture();await f.save(initial)
  forceCloseDatabase(f.connections[0]);await tick()
  assert.deepEqual(await f.journal.read(address),initial)
  assert.equal(f.opens(),2);assert.deepEqual(await f.journal.list(),[initial])
})

test('an unavailable initial open can be retried without replacing or emptying the database',async()=>{
  const f=fixture({failOpen:true})
  await assert.rejects(f.journal.read(address),/RECOVERY_STORAGE_UNAVAILABLE/)
  await f.save(initial);assert.deepEqual(await f.journal.read(address),initial);assert.equal(f.opens(),2)
})

test('a late success after a blocked open closes its connection rather than leaking a rejected handle',async()=>{
  let closed=0
  const request={result:{close(){closed++}}}
  const journal=createRecoveryJournal({indexedDB:{open(){queueMicrotask(()=>request.onblocked());return request}},locks,
    databaseName:'synthetic-blocked-recovery-open',assertRecord:value=>value})
  await assert.rejects(journal.list(),/RECOVERY_STORAGE_UNAVAILABLE/)
  request.onsuccess();assert.equal(closed,1)
})

for(const abortStatus of ['SIGNING','SIGNED','ATTEMPTED','SUBMITTED'])
test(`abort after ${abortStatus} request success never acknowledges an uncommitted recovery phase or repeats transport`,async()=>{
  const f=fixture({abortStatus});await f.save(initial)
  let signatures=0,broadcasts=0
  const send=()=>f.journal.withRecord(address,({record,save})=>submitRecoveryAttempt({record,save,reviewHash,
    sign:async()=>{signatures++;return {transactionHash:'0x'+'3'.repeat(64),rawTransaction:'synthetic-not-broadcastable'}},
    broadcast:async()=>{broadcasts++;return '0x'+'3'.repeat(64)}}))
  await assert.rejects(send(),/RECOVERY_STORAGE_WRITE_FAILED/)
  assert.equal(signatures,abortStatus==='SIGNING'?0:1)
  assert.equal(broadcasts,abortStatus==='SUBMITTED'?1:0)
  const prior={SIGNING:'PREPARED',SIGNED:'SIGNING',ATTEMPTED:'SIGNED',SUBMITTED:'ATTEMPTED'}[abortStatus]
  assert.equal((await f.journal.read(address)).status,prior)
  if(abortStatus!=='SIGNING'){
    await assert.rejects(send(),/RECOVERY_ALREADY_STARTED_OR_REVIEW_CHANGED/)
    assert.equal(signatures,1);assert.equal(broadcasts,abortStatus==='SUBMITTED'?1:0)
  }
})
