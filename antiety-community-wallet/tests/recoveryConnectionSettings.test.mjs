import test from 'node:test'
import assert from 'node:assert/strict'
import {createRecoveryConnectionStore,normalizeRecoveryConnections,normalizeRecoveryCooldown} from '../src/connectionSettings.js'

const sources=['https://first.synthetic.invalid/public-fixture-key','https://second.synthetic.invalid/public-fixture-key']
const value={version:1,sources,cooldownMs:2500}
const memory=()=>{const rows=new Map();return {rows,getItem:key=>rows.get(key)??null,setItem:(key,text)=>rows.set(key,text),removeItem:key=>rows.delete(key)}}

test('edited endpoints and cooldown survive a fresh settings store and whitespace is trimmed',()=>{
  const storage=memory(),first=createRecoveryConnectionStore({storage})
  assert.equal(first.load(sources).settings.cooldownMs,1000)
  assert.equal(first.save({...value,sources:sources.map(url=>' '+url+' ')}),true)
  const reopened=createRecoveryConnectionStore({storage}).load(['https://other.invalid','https://different.invalid'])
  assert.deepEqual(reopened.settings,value);assert.equal(reopened.saved,true)
  assert.equal(storage.rows.size,1)
})

test('settings persistence projects connection fields only and forget removes just its own settings',()=>{
  const storage=memory(),store=createRecoveryConnectionStore({storage});storage.setItem('unrelated','retain')
  store.save({...value,passphrase:'public fixture must not be saved',root:'synthetic secret',backup:{privateKey:'forbidden'}})
  const saved=[...storage.rows.values()].find(text=>text!=='retain')
  assert.deepEqual(JSON.parse(saved),value);assert.doesNotMatch(saved,/passphrase|root|privateKey|backup/)
  assert.equal(store.forget(),true);assert.equal(storage.getItem('unrelated'),'retain');assert.equal(storage.rows.size,1)
})

test('invalid waits, dependent providers and non-RPC origins cannot overwrite good saved settings',()=>{
  const storage=memory(),store=createRecoveryConnectionStore({storage});store.save(value)
  for(const cooldownMs of [0,249,60001,Infinity,NaN,'1000',1.5])assert.throws(()=>normalizeRecoveryCooldown(cooldownMs),/COOLDOWN_INVALID/)
  for(const patch of [{version:2},{sources:[sources[0],sources[0]]},{sources:['http://insecure.invalid',sources[1]]},
    {sources:['https://api.antiety.com',sources[1]]},{sources:['https://one.invalid/'+ 'a'.repeat(8200),sources[1]]},{cooldownMs:0}])
    assert.throws(()=>store.save({...value,...patch}))
  assert.deepEqual(store.load(sources).settings,value)
  for(const cooldownMs of [250,1000,5000,60000])assert.equal(normalizeRecoveryConnections({...value,cooldownMs}).cooldownMs,cooldownMs)
})

test('denied, corrupted and silently failing storage degrade to a session without exposing storage errors',()=>{
  const denied={getItem(){throw new Error('private credential in native error')},setItem(){throw new Error('private')},removeItem(){throw new Error('private')}}
  const store=createRecoveryConnectionStore({storage:denied})
  assert.equal(store.load(sources).unavailable,true);assert.equal(store.save(value),false);assert.equal(store.forget(),false)
  const silent=createRecoveryConnectionStore({storage:{getItem:()=>null,setItem(){},removeItem(){}}})
  assert.equal(silent.save(value),false)
  const storage=memory(),saved=createRecoveryConnectionStore({storage});saved.save(value)
  storage.setItem([...storage.rows.keys()][0],'broken json')
  assert.equal(saved.load(sources).settings.cooldownMs,1000)
  assert.equal(saved.save(value),true);assert.equal(saved.load(sources).saved,true)
})
