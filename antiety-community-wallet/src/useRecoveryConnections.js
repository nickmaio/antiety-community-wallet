import {useEffect,useRef,useState} from 'react'
import {createRecoveryConnectionStore,normalizeRecoveryConnections,DEFAULT_RECOVERY_COOLDOWN_MS} from './connectionSettings.js'

export function useRecoveryConnections(initialSources,chainId=1){
  const [store]=useState(()=>createRecoveryConnectionStore({chainId}))
  const [initial]=useState(()=>store.load(initialSources))
  const [draft,setDraft]=useState(()=>({sources:[...initial.settings.sources],cooldownSeconds:String(initial.settings.cooldownMs/1000)}))
  const [status,setStatus]=useState(initial.saved?'saved':initial.unavailable?'unavailable':'default')
  const edited=useRef(false)
  const current=()=>normalizeRecoveryConnections({version:1,sources:draft.sources,
    cooldownMs:draft.cooldownSeconds.trim()===''?NaN:Number(draft.cooldownSeconds)*1000})
  const persist=()=>{
    let value
    try{value=current()}catch{setStatus('invalid');return false}
    const saved=store.save(value);setStatus(saved?'saved':'unavailable');return saved
  }
  useEffect(()=>{
    if(!edited.current)return
    const timer=setTimeout(persist,500)
    return()=>clearTimeout(timer)
    // Persist only connection drafts; wallet inputs are never dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[draft])
  let valid=true;try{current()}catch{valid=false}
  return {draft,status,current,persist,valid,
    update(next){edited.current=true;setDraft(next);setStatus('editing')},
    reset(){
      edited.current=false
      const removed=store.forget()
      setDraft({sources:[...initialSources],cooldownSeconds:String(DEFAULT_RECOVERY_COOLDOWN_MS/1000)})
      setStatus(removed?'default':'unavailable')
    },
  }
}
