import {getBytes,hexlify} from 'ethers'

const protocol='antiety-independent-search-pages-v1',zero='0x'+'0'.repeat(64)
const fail=code=>{throw new Error('GENERATION_RECOVERY_SCAN_'+code)}
const encode=value=>new TextEncoder().encode(JSON.stringify(value)),decode=value=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(value))
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value)
const atomic=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(value)&&BigInt(value)<1n<<256n
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
const maxRecordChars=262144,pageSize=48
function stateValid(value,context){
  if(value?.version!==1||value.generationId!==context.generationId||value.totalSlots!==context.totalSlots||
    !Number.isInteger(value.scannedSlots)||value.scannedSlots<0||value.scannedSlots>context.totalSlots||
    !Number.isInteger(value.emptyRun)||value.emptyRun<0||value.emptyRun>value.scannedSlots||
    !Array.isArray(value.accounts)||value.accounts.length>value.scannedSlots||
    !['nativeAtomic','entryPointDepositAtomic',...(context.chainId===1?['tokenAtomic']:[])].every(key=>typeof value[key]==='string'&&/^(0|[1-9][0-9]{0,82})$/.test(value[key]))||
    value.snapshot?.chainId!==(context.chainId??1)||!Number.isSafeInteger(value.snapshot.blockNumber)||value.snapshot.blockNumber<0||!hash(value.snapshot.blockHash))fail('INVALID')
}
function rowsValid(rows,start,end,context){
  const token=context.chainId===1
  if(!Array.isArray(rows)||rows.length>end-start)fail('INVALID')
  let previous=start-1
  for(const row of rows){
    if(Object.keys(row).sort().join(',')!=='chainId,deployed,entryPointDepositAtomic,generationId,initializer,nativeAtomic,owner,safeAddress,slot'+(token?',tokenAtomic':'')||
      !Number.isInteger(row.slot)||row.slot<=previous||row.slot>=end||row.generationId!==context.generationId||row.chainId!==(context.chainId??1)||
      !/^0x[0-9a-f]{40}$/i.test(row.safeAddress||'')||!/^0x[0-9a-f]{40}$/i.test(row.owner||'')||
      typeof row.initializer!=='string'||row.initializer.length>4096||!/^0x(?:[0-9a-f]{2})+$/i.test(row.initializer)||
      typeof row.deployed!=='boolean'||!atomic(row.nativeAtomic)||!atomic(row.entryPointDepositAtomic)||token&&!atomic(row.tokenAtomic)||
      row.slot!==0&&!row.deployed&&row.nativeAtomic==='0'&&row.entryPointDepositAtomic==='0'&&(!token||row.tokenAtomic==='0'))fail('INVALID')
    previous=row.slot
  }
}

/** Immutable, bounded encrypted pages plus an encrypted cursor in one strict
 * IndexedDB transaction. Separate from legacy scans and transaction journals.
 * No root, passphrase, URL or decrypted key is stored. A full reopen authenticates
 * the saved prefix without deriving those slots or making blockchain requests.
 */
export function createGenerationPagedScanJournal({indexedDB=globalThis.indexedDB,crypto=globalThis.crypto,
  keyRange=globalThis.IDBKeyRange,chainId=1}={}){
  if(chainId!==1)fail('INVALID')
  let opening
  async function database(){
    if(!indexedDB)fail('STORAGE_UNAVAILABLE')
    if(!opening)opening=new Promise((resolve,reject)=>{
      const request=indexedDB.open(chainId===1?'antiety-independent-generation-mainnet-search-pages-v1':'antiety-independent-generation-search-pages-v1',1)
      request.onupgradeneeded=()=>{request.result.createObjectStore('cursors');request.result.createObjectStore('pages')}
      request.onerror=request.onblocked=()=>reject(new Error('GENERATION_RECOVERY_SCAN_STORAGE_UNAVAILABLE'))
      request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();opening=null};resolve(request.result)}
    })
    return opening
  }
  async function transaction(mode,work){
    const db=await database()
    return new Promise((resolve,reject)=>{
      let result,reason='STORAGE_FAILED'
      const tx=db.transaction(['cursors','pages'],mode,mode==='readwrite'?{durability:'strict'}:undefined)
      tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(new Error('GENERATION_RECOVERY_SCAN_'+reason))
      try{work(tx,value=>{result=value},code=>{reason=code;tx.abort()})}catch{reason='STORAGE_FAILED';tx.abort()}
    })
  }
  const cursorRow=key=>transaction('readonly',(tx,done)=>{tx.objectStore('cursors').get(key).onsuccess=e=>done(e.target.result||null)})
  async function open(root,descriptorHash,input){
    if(!crypto?.subtle||!(root instanceof Uint8Array)||root.length!==32||!hash(descriptorHash)||
      input?.totalSlots!==65536||!hash(input.generationId)||!hash(input.sourceHash)||(input.chainId??1)!==chainId)fail('INVALID')
    const token=chainId===1,context={protocol,descriptorHash,generationId:input.generationId,totalSlots:65536,sourceHash:input.sourceHash,...(token?{chainId}:{})}
    const digest=async value=>hexlify(new Uint8Array(await crypto.subtle.digest('SHA-256',encode(value))))
    const id=await digest(context),copy=root.slice();let key
    try{
      const material=await crypto.subtle.importKey('raw',copy,'HKDF',false,['deriveKey'])
      key=await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:getBytes(descriptorHash),info:encode(context)},
        material,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])
    }finally{copy.fill(0)}
    const active=()=>{if(!key)fail('CLOSED')}
    async function seal(value,header){
      active();const clear=encode(value),iv=crypto.getRandomValues(new Uint8Array(12))
      try{
        const ciphertext=hexlify(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encode(header)},key,clear)))
        active();const row={header,iv:hexlify(iv),ciphertext}
        if(JSON.stringify(row).length>maxRecordChars)fail('INVALID')
        return row
      }finally{clear.fill(0)}
    }
    async function unseal(row,header){
      active();let clear
      try{
        if(!same(row?.header,header)||!/^0x[0-9a-f]{24}$/.test(row.iv||'')||typeof row.ciphertext!=='string'||
          !/^0x(?:[0-9a-f]{2})+$/.test(row.ciphertext)||JSON.stringify(row).length>maxRecordChars)fail('INVALID')
        clear=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:getBytes(row.iv),additionalData:encode(header)},key,getBytes(row.ciphertext)))
        active();return decode(clear)
      }catch{fail('INVALID')}finally{clear?.fill(0)}
    }
    let revision=0,loaded=false,restarting=false,priorRow=null,meta=null
    const cursorHeader=rev=>({protocol,key:id,kind:'cursor',revision:rev})
    return {
      async read({restart=false}={}){
        active();loaded=false;priorRow=await cursorRow(id);active();restarting=restart
        if(!priorRow){revision=0;meta=null;loaded=true;return null}
        revision=priorRow.header?.revision
        if(!Number.isSafeInteger(revision)||revision<1)fail('INVALID')
        meta=await unseal(priorRow,cursorHeader(revision))
        stateValid({...meta,accounts:[]},context)
        if(!/^[0-9a-f]{32}$/.test(meta.runId)||!Number.isInteger(meta.pageCount)||meta.pageCount<0||meta.pageCount>65536||
          !Number.isInteger(meta.accountCount)||meta.accountCount<0||meta.accountCount>meta.scannedSlots||!hash(meta.headHash))fail('INVALID')
        if(restart){loaded=true;return null}
        const accounts=[];let from=0,previousHash=zero,native=0n,reserve=0n,tokens=0n,lastEvidence=-1
        for(let index=0;index<meta.pageCount;){
          active();const count=Math.min(8,meta.pageCount-index),offset=index
          const batch=await transaction('readonly',(tx,done)=>{
            const values=new Array(count);let pending=count
            for(let i=0;i<count;i++)tx.objectStore('pages').get([id,meta.runId,offset+i]).onsuccess=e=>{
              values[i]=e.target.result;if(--pending===0)done(values)
            }
          })
          for(const row of batch){
            active();const head=row?.header
            if(!head||head.start!==from||!Number.isInteger(head.end)||head.end<=from||head.end>Math.min(from+pageSize,context.totalSlots)||
              head.previousHash!==previousHash)fail('INVALID')
            const expected={protocol,key:id,kind:'page',runId:meta.runId,index,start:from,end:head.end,previousHash,
              snapshot:meta.snapshot}
            const found=await unseal(row,expected);rowsValid(found,from,head.end,context)
            for(const account of found){
              native+=BigInt(account.nativeAtomic);reserve+=BigInt(account.entryPointDepositAtomic)
              if(token)tokens+=BigInt(account.tokenAtomic)
              if(account.deployed||account.nativeAtomic!=='0'||account.entryPointDepositAtomic!=='0'||token&&account.tokenAtomic!=='0')lastEvidence=account.slot
              accounts.push(account)
            }
            previousHash=await digest(row);from=head.end;index++
          }
          await new Promise(resolve=>setTimeout(resolve,0))
        }
        if(from!==meta.scannedSlots||previousHash!==meta.headHash||accounts.length!==meta.accountCount||
          native.toString()!==meta.nativeAtomic||reserve.toString()!==meta.entryPointDepositAtomic||token&&tokens.toString()!==meta.tokenAtomic||meta.emptyRun!==from-lastEvidence-1||
          !same(await cursorRow(id),priorRow))fail('INVALID')
        active();loaded=true
        return {version:meta.version,generationId:meta.generationId,totalSlots:meta.totalSlots,scannedSlots:meta.scannedSlots,
          emptyRun:meta.emptyRun,snapshot:meta.snapshot,nativeAtomic:meta.nativeAtomic,entryPointDepositAtomic:meta.entryPointDepositAtomic,accounts,
          ...(token?{tokenAtomic:meta.tokenAtomic}:{})}
      },
      async save(value){
        active();if(!loaded)fail('CONFLICT');stateValid(value,context)
        const initial=meta===null||restarting
        if(initial&&(value.scannedSlots!==0||value.accounts.length||value.emptyRun!==0||value.nativeAtomic!=='0'||value.entryPointDepositAtomic!=='0'||token&&value.tokenAtomic!=='0'))fail('INVALID')
        const from=initial?0:meta.scannedSlots,previousHash=initial?zero:meta.headHash,index=initial?0:meta.pageCount
        const runId=initial?hexlify(crypto.getRandomValues(new Uint8Array(16))).slice(2):meta.runId
        const added=value.accounts.slice(initial?0:meta.accountCount)
        if(!initial&&(value.scannedSlots<=from||value.scannedSlots>Math.min(from+pageSize,context.totalSlots)||
          value.accounts.length<meta.accountCount||!same(value.snapshot,meta.snapshot)))fail('INVALID')
        rowsValid(added,from,value.scannedSlots,context)
        let native=BigInt(initial?0:meta.nativeAtomic),reserve=BigInt(initial?0:meta.entryPointDepositAtomic),tokens=token?BigInt(initial?0:meta.tokenAtomic):0n,last=from-(initial?0:meta.emptyRun)-1
        for(const row of added){native+=BigInt(row.nativeAtomic);reserve+=BigInt(row.entryPointDepositAtomic);if(token)tokens+=BigInt(row.tokenAtomic)
          if(row.deployed||row.nativeAtomic!=='0'||row.entryPointDepositAtomic!=='0'||token&&row.tokenAtomic!=='0')last=row.slot}
        if(native.toString()!==value.nativeAtomic||reserve.toString()!==value.entryPointDepositAtomic||token&&tokens.toString()!==value.tokenAtomic||value.emptyRun!==value.scannedSlots-last-1)fail('INVALID')
        const page=initial?null:await seal(added,{protocol,key:id,kind:'page',runId,index,start:from,end:value.scannedSlots,previousHash,snapshot:value.snapshot})
        const {accounts,...state}=value
        const nextMeta={...state,runId,pageCount:index+(page?1:0),accountCount:accounts.length,headHash:page?await digest(page):zero}
        const next=await seal(nextMeta,cursorHeader(revision+1)),expected=priorRow
        active()
        await transaction('readwrite',(tx,done,reject)=>{
          const cursors=tx.objectStore('cursors'),pages=tx.objectStore('pages')
          const guarded=work=>event=>{try{work(event)}catch{reject('STORAGE_FAILED')}}
          cursors.get(id).onsuccess=guarded(e=>{
            if(!same(e.target.result||null,expected)){reject('CONFLICT');return}
            if(page){
              const pageKey=[id,runId,index]
              pages.get(pageKey).onsuccess=guarded(event=>{
                if(event.target.result){reject('CONFLICT');return}
                pages.add(page,pageKey);cursors.put(next,id);done(true)
              })
            }else{
              if(meta&&restarting){
                if(!keyRange){reject('STORAGE_UNAVAILABLE');return}
                pages.delete(keyRange.bound([id,meta.runId,0],[id,meta.runId,65536]))
              }
              cursors.put(next,id);done(true)
            }
          })
        })
        active();revision++;meta=nextMeta;priorRow=next;restarting=false
      },
      close(){key=null},
    }
  }
  return {open}
}
