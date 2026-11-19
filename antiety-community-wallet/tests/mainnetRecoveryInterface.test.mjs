import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {build} from 'esbuild'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createRecoveryConnectionStore} from '../src/connectionSettings.js'
import {recoverySelectedAsset,recoveryPlanAmount} from '../src/networkPresentation.js'
import {recoveryErrorText} from '../src/messages.js'

const require=createRequire(import.meta.url)
async function component(file){
  const module={exports:{}},result=await build({entryPoints:[fileURLToPath(new URL('../src/'+file,import.meta.url))],
    bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',logLevel:'silent'})
  new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports)
  return module.exports.default
}
const [Recovery,Results,Receipt]=await Promise.all(['GenerationRecovery.jsx','GenerationSearchResults.jsx','CompletedRecoveryReceipt.jsx'].map(component))
const render=(View,props)=>renderToStaticMarkup(React.createElement(View,props))
const sources=['https://first.synthetic.invalid','https://second.synthetic.invalid'],usdt=recoverySelectedAsset(1,'erc20')
const plan={chainId:1,asset:usdt,action:'withdraw',amountAtomic:'1234567',maximumFeeAtomic:'500000000000000',recipient:'0x'+'2'.repeat(40),recoveryOwner:'0x'+'3'.repeat(40)}

test('the recovery entry renders the Community Wallet heading without network choice screens',()=>{
  const html=render(Recovery,{controller:{chainId:1,slotCount:65536,isUnlocked:()=>false},onExit:()=>{},initialSources:sources})
  for(const text of ['Antiety Community Wallet','Ethereum mainnet','Recover Your Antiety Assets'])assert.ok(html.includes(text),text)
  assert.match(html,/src="\.\/assets\/antiety-logo\.png"/)
  assert.match(html,/<section class="card" aria-labelledby="recovery-heading">[\s\S]*<aside class="recovery-overview" aria-labelledby="overview-heading">/)
  for(const text of ['Antiety goes offline or is blocked in your region','A custodial platform holds the keys','Keep your recovery file and passphrase'])
    assert.ok(html.includes(text),text)
  assert.doesNotMatch(html,/Sepolia|Sign in|Open multi-account recovery|Recover Ethereum mainnet ETH \/ USDT/)
})

test('partial mainnet discovery shows USDT-only funds separately from ETH and fee reserves',()=>{
  const account={slot:143,safeAddress:'0x'+'4'.repeat(40),nativeAtomic:'0',entryPointDepositAtomic:'0',tokenAtomic:'1234567'}
  const html=render(Results,{chainId:1,inventory:{coverage:'PARTIAL',pauseReason:'CONNECTION',scannedSlots:144,totalSlots:65536,
    snapshot:{chainId:1,blockNumber:100},nativeAtomic:'0',tokenAtomic:'1234567',entryPointDepositAtomic:'10',holdingsAtomic:'10',accounts:[account]},
    unlocked:true,busy:false,onContinue(){},onExhaustive(){},onRestart(){},onSelect(){}})
  assert.match(html,/<h2 id="search-summary">Found so far<\/h2>/);assert.match(html,/1\.234567 USDT/);assert.match(html,/0\.0 ETH/)
  assert.match(html,/144 of 65,536 accounts checked/);assert.match(html,/Continue search/);assert.doesNotMatch(html,/Sepolia|1\.234567 ETH|Recovered wallet/)
})

test('completed token receipts retain exact USDT amount, ETH fee and the winning transaction reference',()=>{
  const hash='0x'+'5'.repeat(64),old={plan,transactionHash:hash},record={plan:{...plan,maximumFeeAtomic:'900000000000000'},
    transactionHash:'0x'+'6'.repeat(64),resolvedByTransactionHash:hash,history:[old]}
  const html=render(Receipt,{record})
  for(const text of [hash,'1.234567 USDT','0.0005 ETH'])assert.ok(html.includes(text))
  assert.doesNotMatch(html,/Sepolia|0\.0009 ETH|1\.234567 ETH|Export transaction status/)
})

test('Mainnet RPC settings persist and ignore the old testnet preference',()=>{
  const rows=new Map([['antiety.independent-recovery.connections.v1',JSON.stringify({version:1,sources,cooldownMs:2500})]])
  const storage={getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value),removeItem:key=>rows.delete(key)}
  const main=createRecoveryConnectionStore({storage})
  assert.equal(main.load(sources).saved,false)
  const own=['https://main-one.synthetic.invalid','https://main-two.synthetic.invalid']
  assert.equal(main.save({version:1,sources:own,cooldownMs:5000}),true)
  assert.deepEqual(createRecoveryConnectionStore({storage}).load(sources).settings.sources,own)
  assert.equal(main.forget(),true)
  assert.equal(main.load(sources).saved,false)
  assert.throws(()=>createRecoveryConnectionStore({storage,chainId:11155111}))
})

test('mainnet error wording describes the chosen network and token restrictions without upstream content',()=>{
  for(const code of ['WRONG_NETWORK','RECOVERY_OWNER_NEEDS_GAS','INVALID_PAYMENT','DEPLOY_REQUIRED','TOKEN_TRANSFER_RESTRICTED']){
    const message=recoveryErrorText({code,message:'private provider endpoint'},undefined,1)
    assert.doesNotMatch(message,/Sepolia|0\.001|private provider endpoint|could not continue/)
  }
  assert.match(recoveryErrorText({code:'WRONG_NETWORK'}),/Ethereum mainnet/)
  assert.throws(()=>recoverySelectedAsset(11155111,'erc20'))
  assert.equal(recoveryPlanAmount(plan),'1.234567 USDT')
})
