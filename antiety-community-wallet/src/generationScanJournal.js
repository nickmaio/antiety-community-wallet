import {getBytes,hexlify} from 'ethers'

const fail=code=>{throw new Error('GENERATION_RECOVERY_SCAN_'+code)}
const protocol='antiety-recovery-search-progress-v1'
const encode=value=>new TextEncoder().encode(value)
const maxBytes=8*1024*1024

/** Separate from withdrawal journals. Only root-encrypted search checkpoints are stored.
 * The revision comparison and replacement commit in one strict IndexedDB transaction.
 */
export function createGenerationScanJournal({indexedDB=globalThis.indexedDB,crypto=globalThis.crypto}={}){
  let opening
  async function database(){
    if(!indexedDB)fail('STORAGE_UNAVAILABLE')
    if(!opening)opening=new Promise((resolve,reject)=>{
      const request=indexedDB.open('antiety-independent-generation-search-v1',1)
      request.onupgradeneeded=()=>request.result.createObjectStore('searches')
      request.onerror=request.onblocked=()=>reject(new Error('GENERATION_RECOVERY_SCAN_STORAGE_UNAVAILABLE'))
      request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result)}
    })
    return opening
  }
  async function transaction(mode,key,replace){
    const db=await database()
    return new Promise((resolve,reject)=>{
      let value,conflict=false
      const tx=db.transaction('searches',mode,mode==='readwrite'?{durability:'strict'}:undefined)
      tx.oncomplete=()=>resolve(value)
      tx.onerror=tx.onabort=()=>reject(new Error('GENERATION_RECOVERY_SCAN_'+(conflict?'CONFLICT':'STORAGE_FAILED')))
      const store=tx.objectStore('searches'),request=store.get(key)
      request.onsuccess=()=>{
        value=request.result||null
        if(replace){
          if((value?.revision||0)!==replace.expected){conflict=true;tx.abort();return}
          store.put(replace.row,key);value=replace.row
        }
      }
    })
  }
  async function open(root,descriptorHash){
    if(!crypto?.subtle||!(root instanceof Uint8Array)||root.length!==32||!/^0x[0-9a-f]{64}$/i.test(descriptorHash))fail('STORAGE_UNAVAILABLE')
    const copy=root.slice();let key
    try{
      const input=await crypto.subtle.importKey('raw',copy,'HKDF',false,['deriveKey'])
      key=await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:getBytes(descriptorHash),info:encode(protocol)},input,
        {name:'AES-GCM',length:256},false,['encrypt','decrypt'])
    }finally{copy.fill(0)}
    let revision=0
    const aad=rev=>encode(JSON.stringify({protocol,descriptorHash,revision:rev}))
    return {
      async read({restart=false}={}){
        const row=await transaction('readonly',descriptorHash)
        if(!row){revision=0;return null}
        if(row.protocol!==protocol||row.descriptorHash!==descriptorHash||!Number.isSafeInteger(row.revision)||row.revision<1||
          typeof row.iv!=='string'||!/^0x[0-9a-f]{24}$/i.test(row.iv)||typeof row.ciphertext!=='string'||row.ciphertext.length>maxBytes*2)fail('INVALID')
        revision=row.revision
        if(restart)return null
        let clear
        try{
          clear=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:getBytes(row.iv),additionalData:aad(row.revision)},key,getBytes(row.ciphertext)))
          const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(clear));revision=row.revision;return value
        }catch{fail('INVALID')}finally{clear?.fill(0)}
      },
      async save(value){
        const expected=revision,next=expected+1,iv=crypto.getRandomValues(new Uint8Array(12)),clear=encode(JSON.stringify(value))
        if(clear.length>maxBytes)fail('INVALID')
        let ciphertext
        try{ciphertext=hexlify(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(next)},key,clear)))}finally{clear.fill(0)}
        await transaction('readwrite',descriptorHash,{expected,row:{protocol,descriptorHash,revision:next,iv:hexlify(iv),ciphertext}})
        revision=next
      },
      close(){key=null},
    }
  }
  return {open}
}
