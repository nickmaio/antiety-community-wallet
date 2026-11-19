import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {build} from 'esbuild'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'

const require=createRequire(import.meta.url)
const result=await build({entryPoints:[fileURLToPath(new URL('../src/GenerationSearchResults.jsx',import.meta.url))],
  bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',logLevel:'silent'})
const module={exports:{}}
new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports)
const Results=module.exports.default
const inventory={coverage:'PARTIAL',pauseReason:'EMPTY_GAP',scannedSlots:112,totalSlots:65536,snapshot:{blockNumber:100},
  nativeAtomic:'10',tokenAtomic:'0',entryPointDepositAtomic:'7',holdingsAtomic:'17',accounts:[]}
const callbacks={onContinue(){},onExhaustive(){},onRestart(){},onSelect(){}}
const render=(value=inventory,props={})=>renderToStaticMarkup(React.createElement(Results,{inventory:value,unlocked:true,busy:false,...callbacks,...props}))

test('a guided gap labels totals as partial and offers another search segment',()=>{
  const html=render()
  for(const text of ['Found so far','112 of 65,536','last 100 accounts','Continue search','Search options','Check full range'])assert.ok(html.includes(text),text)
  assert.doesNotMatch(html,/Funds found|Recovery complete|>Pause search</)
})
test('a paused search can resume and locked recovery requires unlocking it first',()=>{
  const paused=render({...inventory,pauseReason:'USER'})
  assert.match(paused,/progress is saved/);assert.match(paused,/Continue search/)
  const locked=render(inventory,{unlocked:false})
  assert.match(locked,/Unlock to continue/);assert.doesNotMatch(locked,/>Continue search<|>Check full range</)
  const busy=render(inventory,{busy:true})
  assert.equal((busy.match(/<button/g)||[]).length,(busy.match(/disabled=""/g)||[]).length)
})
test('full verified coverage uses completed totals and retains the fresh-search option',()=>{
  const html=render({...inventory,coverage:'COMPLETE_AT_SNAPSHOT',pauseReason:null,scannedSlots:65536})
  assert.match(html,/Funds found/);assert.match(html,/65,536 of 65,536/)
  assert.match(html,/Start a fresh search/);assert.doesNotMatch(html,/Continue search|Found so far/)
})
test('active search shows one progress display and a pause action',()=>{
  const html=render(inventory,{busy:true,progress:{scannedSlots:114,totalSlots:65536,nativeAtomic:'0',tokenAtomic:'1000000'}})
  assert.match(html,/114 of 65,536/);assert.match(html,/Pause search/);assert.doesNotMatch(html,/Continue search|Start a fresh search/)
})
test('initial waiting does not display an unverified zero balance',()=>{
  const html=render(null,{busy:true,progress:{scannedSlots:0,totalSlots:65536}})
  assert.match(html,/Checking receiving accounts/);assert.doesNotMatch(html,/class="funds"/)
})
test('unverified results show their snapshot and offer a fresh search',()=>{
  const html=render({...inventory,pauseReason:'VERIFICATION',lastKnown:true,requiresFreshSearch:true,scannedSlots:65536})
  assert.match(html,/Found so far/);assert.match(html,/Last verified results at block 100/);assert.match(html,/Start a fresh search/)
  assert.doesNotMatch(html,/>Continue search<|>Check full range<|Funds found/)
})
