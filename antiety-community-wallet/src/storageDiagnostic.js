const databases={legacy:'antiety-independent-recovery-v1',generation:'antiety-independent-generation-recovery-v1'}
const failure=()=>new Error('RECOVERY_STORAGE_DIAGNOSTIC_FAILED')

/** Counts only the selected network's recovery journals. Never reads record contents. */
export async function inspectRecoveryStorage({indexedDB=globalThis.indexedDB,origin=globalThis.location?.origin,
  storage=globalThis.navigator?.storage,locks=globalThis.navigator?.locks,timeoutMs=3000,chainId=1}={}){
  if(chainId!==1)throw failure()
  if(!indexedDB?.databases)throw failure()
  async function deadline(work){
    let timer
    try{return await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure()),timeoutMs)})])}
    finally{clearTimeout(timer)}
  }
  let existing
  try{existing=await deadline(()=>indexedDB.databases());if(!Array.isArray(existing))throw failure()}catch{throw failure()}
  async function count(name){
    if(!existing.some(row=>row.name===name))return {present:false,storePresent:false,recordCount:0}
    return new Promise((resolve,reject)=>{
      let db,finished=false
      const timer=setTimeout(()=>finish(failure()),timeoutMs)
      function finish(error,result){if(finished)return;finished=true;clearTimeout(timer);db?.close();if(error)reject(failure());else resolve(result)}
      const request=indexedDB.open(name)
      // A database disappearing after enumeration must not create a new one.
      request.onupgradeneeded=()=>{request.transaction.abort()}
      request.onerror=request.onblocked=()=>finish(failure())
      request.onsuccess=()=>{
        db=request.result
        if(finished){db.close();return}
        if(!db.objectStoreNames.contains('wallets')){finish(null,{present:true,storePresent:false,recordCount:null});return}
        let recordCount
        try{
          const transaction=db.transaction('wallets','readonly')
          transaction.objectStore('wallets').count().onsuccess=event=>{recordCount=event.target.result}
          transaction.oncomplete=()=>finish(null,{present:true,storePresent:true,recordCount})
          transaction.onerror=transaction.onabort=()=>finish(failure())
        }catch{finish(failure())}
      }
    })
  }
  const selectedDatabases=chainId===1?{generation:'antiety-independent-generation-mainnet-recovery-v1'}:{...databases}
  const rows=await Promise.all(Object.entries(selectedDatabases).map(async([kind,name])=>[kind,{database:name,...await count(name)}]))
  let persistentStorage=null
  if(storage?.persisted){try{persistentStorage=await deadline(()=>storage.persisted())}catch{/* Optional permission-state check only. */}}
  return {diagnostic:'recovery-storage-counts-v1',...(chainId===1?{chainId}:{}),origin:typeof origin==='string'?origin:'unknown',
    webLocksAvailable:!!locks?.request,persistentStorage,journals:Object.fromEntries(rows),
    recordsRead:false,recordsChanged:false,networkUsed:false}
}

/** A separate synthetic marker distinguishes browser persistence from journal logic. */
export function createRecoveryStorageProbe({indexedDB=globalThis.indexedDB,localStorage,
  randomId=()=>globalThis.crypto.randomUUID(),pageId=randomId(),timeoutMs=3000}={}){
  const name='antiety-recovery-storage-probe-v1',key='antiety.recovery.synthetic-storage-probe.v1'
  const fail=()=>new Error('RECOVERY_STORAGE_PROBE_FAILED')
  async function marker(value){
    if(!indexedDB?.databases)throw fail()
    let enumerationTimer
    const existing=await Promise.race([indexedDB.databases(),new Promise((_,reject)=>{enumerationTimer=setTimeout(()=>reject(fail()),timeoutMs)})])
      .finally(()=>clearTimeout(enumerationTimer))
    const exists=existing.some(row=>row.name===name)
    if(!value&&!exists)return null
    return new Promise((resolve,reject)=>{
      let db,finished=false,result=null
      const timer=setTimeout(()=>finish(fail()),timeoutMs)
      function finish(error){if(finished)return;finished=true;clearTimeout(timer);db?.close();if(error)reject(fail());else resolve(result)}
      const request=indexedDB.open(name)
      request.onupgradeneeded=()=>{if(value)request.result.createObjectStore('probe');else request.transaction.abort()}
      request.onerror=request.onblocked=()=>finish(fail())
      request.onsuccess=()=>{
        db=request.result;if(finished){db.close();return}
        try{
          const transaction=db.transaction('probe',value?'readwrite':'readonly',value?{durability:'strict'}:undefined)
          if(value)transaction.objectStore('probe').put(value,'marker')
          else transaction.objectStore('probe').get('marker').onsuccess=event=>{result=event.target.result||null}
          transaction.oncomplete=()=>finish()
          transaction.onerror=transaction.onabort=()=>finish(fail())
        }catch{finish(fail())}
      }
    })
  }
  async function check(){
    try{
      const row=await marker(),local=(localStorage||globalThis.localStorage)?.getItem(key)||null
      const indexedDbMarkerPresent=!!row,localStorageMarkerPresent=!!local
      const markersMatch=!!row&&typeof row.id==='string'&&row.id===local
      return {diagnostic:'recovery-storage-probe-v1',status:markersMatch?
        row.createdBy===pageId?'SAVED_THIS_PAGE_RELOAD_TO_CHECK':'PASSED_AFTER_RELOAD':'MARKER_MISSING_OR_CHANGED',
        indexedDbMarkerPresent,localStorageMarkerPresent,markersMatch,walletRecordsRead:false,walletRecordsChanged:false,networkUsed:false}
    }catch{throw fail()}
  }
  async function save(){
    try{const id=randomId();await marker({version:1,id,createdBy:pageId});(localStorage||globalThis.localStorage).setItem(key,id);const result=await check();if(!result.markersMatch)throw fail();return result}
    catch{throw fail()}
  }
  return {save,check}
}
