import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {build} from 'esbuild'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'

const require=createRequire(import.meta.url)
const result=await build({entryPoints:[fileURLToPath(new URL('../src/CompletedRecoveryReceipt.jsx',import.meta.url))],
  bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',logLevel:'silent'})
const module={exports:{}}
new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports)
const Receipt=module.exports.default
const hash='0x'+'11'.repeat(32),replacementHash='0x'+'22'.repeat(32)
const recipient='0x'+'33'.repeat(20),owner='0x'+'44'.repeat(20)
const plan={chainId:1,asset:{chainId:1,kind:'native',contractAddress:null},action:'withdraw',recipient,amountAtomic:'14390237471352',maximumFeeAtomic:'500000016000000',recoveryOwner:owner}
const base={status:'FINALIZED',transactionHash:hash,plan,rawTransaction:'PRIVATE_SIGNED_BYTES_NOT_FOR_DISPLAY'}
const render=record=>renderToStaticMarkup(React.createElement(Receipt,{record}))

test('completed withdrawal retains exact reference, recipient, and amount while locked',()=>{
  const html=render(base)
  for(const value of [hash,recipient,'0.000014390237471352 ETH','0.000500000016 ETH',owner])assert.ok(html.includes(value))
  assert.match(html,/>Withdrawal</)
  assert.match(html,/<summary>Fee details<\/summary>/)
  assert.doesNotMatch(html,/PRIVATE_SIGNED_BYTES_NOT_FOR_DISPLAY|>Approve and submit<|<input|Export transaction status/)
})

test('failed finalized activation keeps its own reference and receipt without mislabeling it as a withdrawal',()=>{
  const html=render({...base,status:'FAILED_FINALIZED',plan:{...plan,action:'deploy',recipient:null,amountAtomic:'0'}})
  assert.match(html,/>Account activation</);assert.doesNotMatch(html,/<dt>Amount<\/dt>/)
  assert.ok(html.includes(hash))
  assert.doesNotMatch(html,/Withdrawal|<dt>To<\/dt>/)
})

test('a finalized reserve return identifies the same-account destination and exact amount',()=>{
  const html=render({...base,plan:{...plan,action:'return-gas'}})
  assert.match(html,/>Network fee reserve return</);assert.match(html,/<dt>Return to<\/dt>/)
  assert.ok(html.includes(recipient));assert.ok(html.includes('0.000014390237471352 ETH'))
})

test('when an older attempt wins, reference and approved fee both belong to that attempt',()=>{
  const replacement={...base,transactionHash:replacementHash,plan:{...plan,maximumFeeAtomic:'900000000000000'},
    resolvedByTransactionHash:hash,history:[base]}
  const html=render(replacement)
  assert.ok(html.includes(hash));assert.ok(html.includes('0.000500000016 ETH'))
  assert.ok(!html.includes(replacementHash));assert.ok(!html.includes('0.0009 ETH'))
  // A replacement review can remain unsigned when its parent is confirmed.
  assert.equal(render({...replacement,transactionHash:undefined,rawTransaction:undefined}),html)
})

test('a winning replacement uses its own fee',()=>{
  const html=render({...base,transactionHash:replacementHash,resolvedByTransactionHash:replacementHash,
    plan:{...plan,maximumFeeAtomic:'900000000000000'},history:[base]})
  assert.ok(html.includes(replacementHash));assert.ok(html.includes('0.0009 ETH'))
  assert.ok(!html.includes(hash));assert.ok(!html.includes('0.000500000016 ETH'))
})
