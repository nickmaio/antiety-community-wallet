import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {build} from 'esbuild'
import {JSDOM} from 'jsdom'
import React,{act} from 'react'

const require=createRequire(import.meta.url)
const result=await build({entryPoints:[fileURLToPath(new URL('../src/GenerationRecovery.jsx',import.meta.url))],
  bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',logLevel:'silent'})
const compiled={exports:{}}
new Function('require','module','exports',result.outputFiles[0].text)(require,compiled,compiled.exports)
const Recovery=compiled.exports.default
const sources=['https://first.synthetic.invalid','https://second.synthetic.invalid']
const address='0x'+'4'.repeat(40),recoveryOwner='0x'+'5'.repeat(40),recipient='0x'+'6'.repeat(40),reference='0x'+'7'.repeat(64)
const descriptor={safeAddress:address,recoveryOwner,slot:143,generation:{generationId:'synthetic'}}
const native={chainId:1,kind:'native',contractAddress:null}
const inventory={coverage:'PARTIAL',pauseReason:'USER',scannedSlots:144,totalSlots:65536,snapshot:{chainId:1,blockNumber:100},
  nativeAtomic:'0',tokenAtomic:'1234567',entryPointDepositAtomic:'0',holdingsAtomic:'0',
  accounts:[{slot:143,safeAddress:address,nativeAtomic:'0',entryPointDepositAtomic:'0',tokenAtomic:'1234567'}]}

async function mount(t,controller){
  const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://recovery.synthetic.invalid',pretendToBeVisual:true})
  const originals=new Map()
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true})){
    originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key))
    Object.defineProperty(globalThis,key,{value,configurable:true,writable:true})
  }
  const {createRoot}=await import('react-dom/client')
  const {document}=dom.window, root=createRoot(document.getElementById('root'))
  t.after(async()=>{
    await act(()=>root.unmount());dom.window.close()
    for(const [key,original] of originals){
      if(original)Object.defineProperty(globalThis,key,original)
      else delete globalThis[key]
    }
  })
  const button=label=>[...document.querySelectorAll('button')].find(item=>item.textContent.trim()===label||item.getAttribute('aria-label')===label)
  async function click(label){
    const target=button(label)
    assert.ok(target&&!target.disabled,label)
    await act(async()=>target.click())
  }
  async function input(id,value){
    const element=document.querySelector('#'+id)
    const property=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element),'value')
    await act(async()=>{
      property.set.call(element,value)
      const event=element.tagName==='SELECT'?'change':'input'
      element.dispatchEvent(new dom.window.Event(event,{bubbles:true}))
    })
  }
  const title=()=>document.querySelector('h1').textContent
  await act(async()=>root.render(React.createElement(Recovery,{controller,initialSources:sources})))
  return {dom,document,button,click,input,title}
}

function accountFixture({deployed=true,gas=10n,reserve=0n,checkError,prepareError}={}){
  const calls=[]
  const plan={chainId:1,action:'withdraw',recipient,recoveryOwner,asset:native,
    amountAtomic:'1000000000000000000',maximumFeeAtomic:'1000000000000000',createdAt:1,expiresAt:2,reviewHash:'synthetic'}
  let row={descriptor,status:'READY',plan:null},unlocked=true
  const controller={chainId:1,isUnlocked:()=>unlocked,lock(){unlocked=false},setRpc(){},list:async()=>[row],read:async()=>row,
    discover:async()=>inventory,inventory:()=>inventory,selectAccount:async slot=>{calls.push(['select',slot]);return row},
    check:async({asset})=>{
      calls.push(['check',asset.kind])
      if(asset.kind==='erc20'&&checkError)throw Error(checkError)
      return {deployed,safeBalance:0n,tokenBalance:asset.kind==='erc20'?1234567n:undefined,entryPointDeposit:reserve,recoveryBalance:gas}
    },
    prepare:async input=>{
      calls.push(['prepare',input])
      if(prepareError)throw Error(prepareError)
      return row={descriptor,status:'PREPARED',plan:{...plan,...input,recipient:input.recipient||recipient,amountAtomic:'1234567',
        expiresAt:calls.filter(([name])=>name==='prepare').length===1?2:Date.now()+300000}}
    },
    submit:async(hash,approved)=>{
      calls.push(['submit',hash,approved]);return row={...row,status:'SUBMITTED',transactionHash:reference}
    }}
  return {controller,calls,plan,setGas:value=>{gas=value}}
}

test('the opening view has a single recovery form and settings has its own screen',async t=>{
  const ui=await mount(t,{chainId:1,isUnlocked:()=>false,lock(){},list:async()=>[]})
  assert.equal(ui.title(),'Recover Your Antiety Assets')
  assert.equal(ui.document.querySelectorAll('input[type=file]').length,1)
  assert.ok(ui.button('Unlock Funds').classList.contains('recovery-submit'))
  assert.equal(ui.document.querySelector('#overview-heading').textContent,"What 'self-custodial' means?")
  const phrase=ui.document.querySelector('#generation-phrase')
  const toggle=phrase.parentElement.querySelector('button[aria-controls="generation-phrase"]')
  assert.equal(toggle.type,'button')
  assert.equal(toggle.getAttribute('aria-label'),'Show recovery passphrase')
  await ui.input('generation-phrase','synthetic test phrase')
  await act(async()=>toggle.click())
  assert.equal(phrase.type,'text')
  assert.equal(phrase.value,'synthetic test phrase')
  assert.equal(toggle.getAttribute('aria-label'),'Hide recovery passphrase')
  await act(async()=>toggle.click())
  assert.equal(phrase.type,'password')
  assert.match(ui.document.body.textContent,/Ethereum Mainnet|Ethereum mainnet/)
  assert.equal(ui.document.querySelector('input[type=url]'),null)
  const settings=ui.button('Settings')
  assert.equal(settings.textContent.trim(),'')
  assert.ok(settings.querySelector('svg'))
  await ui.click('Settings')
  assert.equal(ui.title(),'Connection Settings')
  assert.equal(ui.document.querySelectorAll('input[type=url]').length,2)
  assert.equal(ui.document.querySelector('input[type=file]'),null)
  await ui.click('‹ Back')
  assert.equal(ui.title(),'Recover Your Antiety Assets')
})

test('search options explain private receiving addresses and let users switch to a known account',async t=>{
  const ui=await mount(t,{chainId:1,isUnlocked:()=>false,lock(){},list:async()=>[]})
  const options=ui.document.querySelector('.search-options').closest('details')
  await act(async()=>{options.open=true})
  assert.match(options.querySelector('.search-explanation').textContent,/help keep your payments private/)
  assert.match(options.textContent,/Check all 65,536 accounts \(lengthy\)/)
  const estimate=options.querySelector('#generation-sender-estimate')
  assert.equal(ui.document.getElementById(estimate.getAttribute('aria-describedby')).textContent,
    'How many people have ever sent you digital assets or purchased from you through Antiety')
  assert.equal(ui.button('Open a known receiving account').type,'button')
  await ui.click('Open a known receiving account')
  assert.ok(options.querySelector('#generation-account-address').required)
  assert.equal(options.querySelector('#generation-sender-estimate'),null)
  assert.equal(ui.button('Open receiving account').type,'submit')
  await ui.click('Back to scan options')
  assert.ok(options.querySelector('#generation-sender-estimate'))
  assert.equal(options.querySelector('#generation-account-address'),null)
})

test('a USDT-only account moves from results to balances and then a withdrawal form',async t=>{
  const f=accountFixture(),ui=await mount(t,f.controller)
  assert.equal(ui.title(),'Find Assets')
  assert.match(ui.document.body.textContent,/Found so far/)
  assert.match(ui.document.body.textContent,/144 of 65,536 accounts checked/)
  assert.match(ui.document.querySelector('.account-funds').textContent,/1\.234567 USDT/)
  await ui.click('Receiving account 144›')
  assert.equal(ui.title(),'Receiving Account')
  assert.equal(ui.document.querySelector('.account-list'),null)
  assert.equal(ui.document.querySelector('#generation-asset'),null)
  await ui.click('Withdraw')
  await ui.input('generation-asset','erc20')
  assert.equal(ui.title(),'Withdraw')
  assert.match(ui.document.body.textContent,/Available · 1\.234567 USDT/)
  assert.deepEqual(f.calls,[['select',143],['check','erc20']])
})

test('the funding step shows the separate Ethereum gas address and refreshes its balance',async t=>{
  const f=accountFixture({gas:0n}),ui=await mount(t,f.controller),clipboard=[]
  Object.defineProperty(ui.dom.window.navigator,'clipboard',{value:{writeText:async value=>clipboard.push(value)}})
  await ui.click('Receiving account 144›')
  assert.equal(ui.button('Withdraw'),undefined)
  await ui.click('View funding address')
  assert.equal(ui.title(),'Add ETH for network fees')
  assert.equal(ui.document.querySelector('.reference code').textContent,recoveryOwner)
  await ui.click('Copy')
  assert.deepEqual(clipboard,[recoveryOwner])
  f.setGas(100n)
  await ui.click('Check balance')
  await ui.click('Continue to account')
  assert.ok(ui.button('Withdraw'))
  assert.equal(f.calls.some(([name])=>name==='prepare'),false)
})

test('a fee shortfall sends the user to the gas address and preserves withdrawal entries',async t=>{
  const f=accountFixture({prepareError:'RECOVERY_OWNER_NEEDS_GAS'}),ui=await mount(t,f.controller)
  await ui.click('Receiving account 144›')
  await ui.click('Withdraw')
  await ui.input('generation-asset','erc20')
  await ui.input('generation-recipient',recipient)
  await ui.input('generation-amount','1.234567')
  await ui.click('Review withdrawal')
  assert.equal(ui.title(),'Add ETH for network fees')
  await ui.click('‹ Back')
  assert.equal(ui.title(),'Withdraw')
  assert.equal(ui.document.querySelector('#generation-recipient').value,recipient)
  assert.equal(ui.document.querySelector('#generation-amount').value,'1.234567')
})

test('a token policy restriction leaves the ETH account usable',async t=>{
  const f=accountFixture({checkError:'TOKEN_TRANSFER_RESTRICTED'}),ui=await mount(t,f.controller)
  await ui.click('Receiving account 144›')
  assert.match(ui.document.querySelector('.funds').textContent,/USDTUnavailable/)
  await ui.click('Withdraw')
  assert.equal(ui.document.querySelector('option[value="erc20"]').disabled,true)
  assert.deepEqual(f.calls,[['select',143],['check','erc20'],['check','native']])
})

test('an expired USDT review refreshes the same payment and requires explicit approval',async t=>{
  const f=accountFixture(),ui=await mount(t,f.controller)
  await ui.click('Receiving account 144›')
  await ui.click('Withdraw')
  await ui.input('generation-asset','erc20')
  await ui.input('generation-recipient',recipient)
  await ui.input('generation-amount','1.234567')
  await ui.click('Review withdrawal')
  assert.equal(ui.title(),'Review Withdrawal')
  assert.match(ui.document.body.textContent,/1\.234567 USDT/)
  assert.match(ui.document.body.textContent,new RegExp(recipient))
  assert.equal(ui.button('Approve and submit'),undefined)
  await ui.click('Refresh fee')
  assert.equal(ui.button('Approve and submit').disabled,true)
  const attempts=f.calls.filter(([name])=>name==='prepare').map(([,input])=>input)
  assert.equal(attempts.length,2)
  for(const input of attempts){
    assert.equal(input.amount,'1.234567')
    assert.equal(input.asset.kind,'erc20')
    assert.equal(input.recipient,recipient)
  }
  await act(async()=>ui.document.querySelector('.approval input').click())
  await ui.click('Approve and submit')
  assert.equal(ui.title(),'Awaiting confirmation')
  assert.deepEqual(f.calls.at(-1),['submit','synthetic',true])
})

test('an inactive account needs activation before withdrawal',async t=>{
  const f=accountFixture({deployed:false}),ui=await mount(t,f.controller)
  await ui.click('Receiving account 144›')
  assert.equal(ui.button('Withdraw'),undefined)
  await ui.click('Review activation')
  assert.equal(ui.title(),'Review Activation')
  assert.equal(f.calls.at(-1)[1].action,'deploy')
})

test('a deployed account can review the full ETH fee reserve',async t=>{
  const f=accountFixture({reserve:500000000000000000n}),ui=await mount(t,f.controller)
  await ui.click('Receiving account 144›')
  await ui.click('Return fee reserve')
  assert.equal(ui.title(),'Review fee reserve return')
  const [,input]=f.calls.at(-1)
  assert.equal(input.action,'return-gas');assert.equal(input.amount,'0.5');assert.deepEqual(input.asset,native)
})

for(const online of [true,false])test(`the page reopens pending transaction evidence ${online?'and checks finality':'even when an RPC fails'}`,async t=>{
  const calls=[],plan={chainId:1,action:'withdraw',recipient,recoveryOwner,asset:native,
    amountAtomic:'1000000000000000000',maximumFeeAtomic:'1000000000000000',createdAt:1}
  const pending={descriptor,plan,status:'SUBMITTED',transactionHash:reference}
  const completed={...pending,descriptor:{safeAddress:'0x'+'8'.repeat(40)},plan:{...plan,createdAt:2},status:'FINALIZED'}
  const controller={chainId:1,isUnlocked:()=>false,lock(){},list:async()=>[completed,pending],read:async()=>pending,
    openSaved:async value=>{calls.push(['open',value]);return pending},setRpc:value=>calls.push(['sources',value]),
    reconcile:async()=>{calls.push(['reconcile']);if(!online)throw Error('RPC_REQUEST_FAILED');return {...pending,status:'FINALIZED'}},
    unlock:()=>assert.fail('Startup requested a key'),submit:()=>assert.fail('Startup attempted a submission'),
    check:()=>assert.fail('Startup requested an unrelated balance check')}
  const ui=await mount(t,controller)
  assert.deepEqual(calls,[['open',address],['sources',sources],['reconcile']])
  assert.equal(ui.title(),online?'Transaction finalized':'Awaiting confirmation')
  assert.equal(ui.document.querySelector('input[type=file]'),null)
  assert.equal(ui.document.querySelector(`[title="${reference}"]`).title,reference)
  assert.ok(ui.button(online?'Back to account':'Retry'))
  if(!online){
    assert.match(ui.document.querySelector('[role=alert]').textContent,/Could not reach both blockchain sources/)
    assert.ok(ui.button('Connection settings'))
    assert.equal(ui.button('Check status'),undefined)
  }
})
