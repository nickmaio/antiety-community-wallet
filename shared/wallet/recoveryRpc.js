import { MAINNET_GENERATION_PINS } from './mainnetGenerationPins.js'
import {resolveWalletAsset} from './assets.js'
import { requireRecoveryTest } from './recoveryExecution.js'

export function createRecoveryRpcTransport({ getAddress, keccak256, safeInterface,Interface,network='ethereum-mainnet' }) {
requireRecoveryTest(network==='ethereum-mainnet','WRONG_NETWORK')
const pins=MAINNET_GENERATION_PINS
requireRecoveryTest(typeof Interface==='function','INVALID_RPC_ADAPTER')
const tokenInterface=new Interface(['function balanceOf(address) view returns(uint256)',
  'function decimals() view returns(uint256)','function deprecated() view returns(bool)','function basisPointsRate() view returns(uint256)',
  'function maximumFee() view returns(uint256)','function paused() view returns(bool)','function isBlackListed(address) view returns(bool)'])
const READS = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_getBalance',
  'eth_getStorageAt', 'eth_getTransactionCount', 'eth_call', 'eth_getTransactionReceipt'])
READS.add('eth_getTransactionByHash')
READS.add('eth_estimateGas')
const PROXY_HASH = '0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c'
const SENTINEL = '0x0000000000000000000000000000000000000001'
const RESOURCE_READS = new Set(['eth_getBlockByNumber', 'eth_getCode', 'eth_getBalance',
  'eth_getStorageAt', 'eth_getTransactionCount', 'eth_call'])
function commonRecoveryBlock(left, right) {
  const now = Math.floor(Date.now() / 1000)
  for (const head of [left, right]) requireRecoveryTest(Number.isSafeInteger(head.number) &&
    head.number >= 0 && Number.isSafeInteger(head.timestamp) && head.timestamp >= now - 120 &&
    head.timestamp <= now + 30, 'RPC_HEAD_STALE')
  requireRecoveryTest(Math.abs(left.number - right.number) <= 2 &&
    (left.number !== right.number || left.hash.toLowerCase() === right.hash.toLowerCase()), 'RPC_HEAD_DISAGREEMENT')
  return left.number <= right.number ? left : right
}
function validateRecoveryRpcUrls(urls) {
  requireRecoveryTest(Array.isArray(urls) && urls.length === 2, 'TWO_RPC_SOURCES_REQUIRED')
  const parsed = urls.map(url => {
    let value
    try { value = new URL(url) } catch { throw new Error('INVALID_RPC_URL') }
    requireRecoveryTest(value.protocol === 'https:' && !value.username && !value.password &&
      !['antiety.com', 'aeion.org', 'googleapis.com'].some(domain =>
        value.hostname === domain || value.hostname.endsWith(`.${domain}`)), 'INDEPENDENT_HTTPS_RPC_REQUIRED')
    return value
  })
  requireRecoveryTest(parsed[0].hostname !== parsed[1].hostname, 'INDEPENDENT_RPC_HOSTS_REQUIRED')
  return urls
}

/** Explicit test-only override. Never accept an API credential as a CLI argument. */
function applyPublicRecoveryRpcOverride(urls, secondaryPublicRpcUrl) {
  if (!secondaryPublicRpcUrl) return validateRecoveryRpcUrls(urls)
  requireRecoveryTest(Array.isArray(urls) && urls.length === 2, 'TWO_RPC_SOURCES_REQUIRED')
  let publicUrl
  try { publicUrl = new URL(secondaryPublicRpcUrl) } catch { throw new Error('INVALID_PUBLIC_RPC_URL') }
  requireRecoveryTest(publicUrl.protocol === 'https:' && !publicUrl.username && !publicUrl.password &&
    !publicUrl.search && !publicUrl.hash && publicUrl.pathname === '/', 'PUBLIC_RPC_MUST_BE_CREDENTIAL_FREE')
  return validateRecoveryRpcUrls([urls[0], publicUrl.href])
}

function createRecoveryRpc(urls, fetchImpl = fetch, { minimumIntervalMs = 350, stateDeadlineMs = 60000, readRetryDelayMs = 500 } = {}) {
  validateRecoveryRpcUrls(urls)
  let nextId = 0
  const lanes = [Promise.resolve(), Promise.resolve()]
  const nextReadAt = [0, 0]
  async function bounded(run, milliseconds, abort) {
    let timer
    try {
      return await Promise.race([run(), new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          const error = new DOMException('RPC deadline exceeded', 'TimeoutError')
          abort(error); reject(error)
        }, milliseconds)
      })])
    } finally { clearTimeout(timer) }
  }
  async function call(index, method, params, allowSubmit = false) {
    requireRecoveryTest(READS.has(method) || allowSubmit && method === 'eth_sendRawTransaction', 'RPC_METHOD_DENIED')
    const id = ++nextId
    let httpStatus = null, rpcCode = null, rpcRejection = false, rpcCategory = null
    const startedAt = Date.now()
    const requestController = new AbortController()
    try {
      return await bounded(async () => {
      const response = await fetchImpl(urls[index], { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), redirect: 'error',
        signal: requestController.signal })
      httpStatus = response.status
      requireRecoveryTest(response.ok, 'RPC_HTTP_FAILURE')
      const reader = response.body.getReader()
      const chunks = []; let size = 0
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          requireRecoveryTest(size <= 131072, 'RPC_RESPONSE_TOO_LARGE')
          chunks.push(value)
        }
      } finally { void reader.cancel().catch(() => {}) }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      rpcCode = Number.isInteger(body?.error?.code) ? body.error.code : null
      rpcRejection = response.ok && body?.jsonrpc === '2.0' && body.id === id &&
        !!body.error && rpcCode !== null && !Object.hasOwn(body, 'result')
      if (rpcRejection) {
        const message = String(body.error.message || '')
        rpcCategory = /underpriced|fee.*low|price.*low/i.test(message) ? 'underpriced' :
          /nonce.*low/i.test(message) ? 'nonce-too-low' : /already.*known/i.test(message) ? 'already-known' :
            /insufficient.*fund/i.test(message) ? 'insufficient-funds' : /intrinsic.*gas/i.test(message) ? 'intrinsic-gas' :
              /unsupported|method.*not.*found/i.test(message) ? 'unsupported-method' :
                /rate|limit|quota|capacity/i.test(message) ? 'rate-or-limit' : 'other'
      }
      requireRecoveryTest(body?.jsonrpc === '2.0' && body.id === id &&
        !body.error && Object.hasOwn(body, 'result'), 'RPC_RESPONSE_INVALID')
      return body.result
      }, 8000, reason => requestController.abort(reason))
    } catch (cause) {
      const error = new Error('RPC_REQUEST_FAILED')
      error.source = index === 0 ? 'primary' : 'secondary'
      error.method = method
      error.httpStatus = httpStatus
      error.rpcCode = rpcCode
      error.rpcRejection = rpcRejection
      error.rpcCategory = rpcCategory
      error.durationMs = Date.now() - startedAt
      error.category = ['TimeoutError', 'AbortError'].includes(cause.name) ? 'timeout' :
        cause.name === 'SyntaxError' ? 'non-json' :
          ['RPC_HTTP_FAILURE', 'RPC_RESPONSE_TOO_LARGE', 'RPC_RESPONSE_INVALID'].includes(cause.code)
            ? cause.code.toLowerCase() : 'transport-or-internal'
      throw error
    }
  }
  // Avoid both simultaneous reads and short request bursts on each provider.
  function enqueue(index, method, params, allowSubmit = false) {
    requireRecoveryTest(index === 0 || index === 1, 'INVALID_RPC_SOURCE')
    const pending = lanes[index].then(async () => {
      for (let attempt = 0; ; attempt++) {
        if (!allowSubmit) {
          const wait = Math.max(0, nextReadAt[index] - Date.now())
          if (wait) await new Promise(resolve => setTimeout(resolve, wait))
          nextReadAt[index] = Date.now() + minimumIntervalMs
        }
        try { return await call(index, method, params, allowSubmit) }
        catch (error) {
          // A provider's balanced nodes can briefly lack the same requested resource.
          // Retry only an identified read rejection, with the exact same parameters.
          // Never retry sending, malformed replies, disagreement or other RPC errors.
          if (allowSubmit || !RESOURCE_READS.has(method) || !error.rpcRejection ||
              error.rpcCode !== -32001 || attempt >= 2) throw error
          await new Promise(resolve => setTimeout(resolve, readRetryDelayMs * (attempt + 1)))
        }
      }
    })
    lanes[index] = pending.then(() => {}, () => {})
    return pending
  }
  const read = (index, method, params) => enqueue(index, method, params)
  async function agree(method, params) {
    const values = await Promise.all([read(0, method, params), read(1, method, params)])
    requireRecoveryTest(JSON.stringify(values[0]) === JSON.stringify(values[1]), 'RPC_DISAGREEMENT')
    return values[0]
  }
  function block(row) {
    requireRecoveryTest(row && /^0x[0-9a-f]{64}$/i.test(row.hash || ''), 'INVALID_BLOCK')
    return { number: Number(BigInt(row.number)), timestamp: Number(BigInt(row.timestamp)), hash: row.hash }
  }
  async function state(descriptor,{asset,recipient}={}) {
    requireRecoveryTest(String(descriptor.chainId)===String(pins.chainId),'WRONG_NETWORK')
    let token=false
    if(asset!==undefined){let selected;try{selected=resolveWalletAsset(asset)}catch{requireRecoveryTest(false,'INVALID_RECOVERY_ASSET')}
      requireRecoveryTest(selected.chainId===pins.chainId,'WRONG_NETWORK');token=selected.kind==='erc20'}
    if(token&&recipient!==undefined)recipient=getAddress(recipient)
    requireRecoveryTest(await agree('eth_chainId', []) === '0x'+pins.chainId.toString(16), 'WRONG_NETWORK')
    const heads = await Promise.all([read(0, 'eth_getBlockByNumber', ['latest', false]),
      read(1, 'eth_getBlockByNumber', ['latest', false])])
    const common = commonRecoveryBlock(...heads.map(block))
    const tag = `0x${common.number.toString(16)}`
    const observations = await Promise.all([read(0, 'eth_getBlockByNumber', [tag, false]),
      read(1, 'eth_getBlockByNumber', [tag, false])])
    const observed = observations[0]
    const identity = row => JSON.stringify({ ...block(row), hash: row.hash.toLowerCase(),
      baseFee: BigInt(row.baseFeePerGas).toString() })
    requireRecoveryTest(identity(observed) === identity(observations[1]), 'RPC_DISAGREEMENT')
    requireRecoveryTest(observed.hash.toLowerCase() === common.hash.toLowerCase(), 'RPC_DISAGREEMENT')
    const contracts = [...Object.entries(pins.contractCodeHashes).map(([name, hash]) =>
      [pins.contracts[name], hash, name]), ...['entryPoint', 'module', 'moduleSetup',...(token?['usdt']:[])].map(name => [pins[name].address, pins[name].codeHash, name])]
    // Avoid large JSON-RPC batches and burst every pin at once.
    for (let index = 0; index < contracts.length; index += 3) {
      await Promise.all(contracts.slice(index, index + 3).map(async ([address, hash, name]) => {
        try { requireRecoveryTest(keccak256(await agree('eth_getCode', [address, tag])) === hash, 'STACK_CODE_CHANGED') }
        catch (error) { error.contract = name; throw error }
      }))
    }
    const [code, safeBalance, recoveryBalance, nonce, pendingNonce] = await Promise.all([
      agree('eth_getCode', [descriptor.safeAddress, tag]),
      agree('eth_getBalance', [descriptor.safeAddress, tag]),
      agree('eth_getBalance', [descriptor.recoveryOwner, tag]),
      agree('eth_getTransactionCount', [descriptor.recoveryOwner, tag]),
      agree('eth_getTransactionCount', [descriptor.recoveryOwner, 'pending']),
    ])
    const result = { chainId: pins.chainId, deployed: code !== '0x',
      safeBalance: BigInt(safeBalance), recoveryBalance: BigInt(recoveryBalance),
      eoaNonce: BigInt(nonce), pendingEoaNonce: BigInt(pendingNonce), safeNonce: null,
      baseFee: BigInt(observed.baseFeePerGas), blockNumber: common.number, blockHash: common.hash }
    if (result.deployed) {
      requireRecoveryTest(keccak256(code) === PROXY_HASH, 'SAFE_PROXY_CODE_CHANGED')
      const call = async name => safeInterface.decodeFunctionResult(name,
        await agree('eth_call', [{ to: descriptor.safeAddress,
          data: safeInterface.encodeFunctionData(name, name === 'getModulesPaginated' ? [SENTINEL, 10] : []) }, tag]))
      const [owners, threshold, safeNonce, singleton, modules, fallback] = await Promise.all([
        call('getOwners'), call('getThreshold'), call('nonce'),
        agree('eth_getStorageAt', [descriptor.safeAddress, '0x0', tag]), call('getModulesPaginated'),
        agree('eth_getStorageAt', [descriptor.safeAddress,
          '0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5', tag]),
      ])
      const normalized = list => list.map(value => getAddress(value).toLowerCase()).sort().join(',')
      requireRecoveryTest(normalized(owners[0]) === normalized(descriptor.initialization.owners) &&
        threshold[0] === 1n && getAddress(`0x${singleton.slice(-40)}`) === pins.contracts.safeSingletonAddress &&
        getAddress(`0x${fallback.slice(-40)}`) === pins.module.address &&
        modules[0].length === 1 && getAddress(modules[0][0]) === pins.module.address &&
        getAddress(modules[1]) === SENTINEL, 'SAFE_CONFIGURATION_CHANGED')
      result.safeNonce = safeNonce[0]
    }
    if(token){
      const tokenCall=async(name,args=[])=>{
        const output=await agree('eth_call',[{to:pins.usdt.address,data:tokenInterface.encodeFunctionData(name,args)},tag])
        const decoded=tokenInterface.decodeFunctionResult(name,output)
        requireRecoveryTest(tokenInterface.encodeFunctionResult(name,decoded).toLowerCase()===output.toLowerCase(),'RPC_DISAGREEMENT')
        return decoded[0]
      }
      const [balance,decimals,deprecated,rate,maximumFee,paused,blocked]=await Promise.all([
        tokenCall('balanceOf',[descriptor.safeAddress]),tokenCall('decimals'),tokenCall('deprecated'),tokenCall('basisPointsRate'),
        tokenCall('maximumFee'),tokenCall('paused'),tokenCall('isBlackListed',[descriptor.safeAddress])])
      requireRecoveryTest(decimals===6n&&deprecated===false&&rate===0n&&maximumFee===0n,'TOKEN_POLICY_CHANGED')
      requireRecoveryTest(paused===false&&blocked===false&&(!recipient||await tokenCall('isBlackListed',[recipient])===false),'TOKEN_TRANSFER_RESTRICTED')
      result.tokenBalance=balance
    }
    const final=await agree('eth_getBlockByNumber',[tag,false])
    requireRecoveryTest(final.hash?.toLowerCase()===common.hash.toLowerCase()&&block(final).number===common.number,'RPC_DISAGREEMENT')
    requireRecoveryTest(common.timestamp >= Math.floor(Date.now() / 1000) - 120, 'RPC_HEAD_STALE')
    return result
  }
  const boundedState = stateDeadlineMs ? (descriptor,options) => {
    const controller = new AbortController()
    // Scope cancellation to this read-only check, including response-body reads.
    const scoped = createRecoveryRpc(urls, (url, options) => fetchImpl(url, {
      ...options, signal: AbortSignal.any([options.signal, controller.signal]),
    }), { minimumIntervalMs, stateDeadlineMs: 0, readRetryDelayMs })
    return bounded(() => scoped.state(descriptor,options), stateDeadlineMs, reason => controller.abort(reason))
      .catch(error => {
        if (error.name === 'TimeoutError') throw new Error('RPC_CHECK_TIMEOUT')
        throw error
      })
  } : state
  return { state: boundedState, read, agree,
    broadcastOnce: (raw, index = 0) => enqueue(index, 'eth_sendRawTransaction', [raw], true) }
}

return { validateRecoveryRpcUrls, applyPublicRecoveryRpcOverride, createRecoveryRpc }
}
