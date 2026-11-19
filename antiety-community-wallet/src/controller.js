import { recoveryIsTerminal, recoveryIsUnresolved } from '../../shared/wallet/recoveryRecord.js'
import { submitRecoveryAttempt } from '../../shared/wallet/recoverySubmission.js'
import {estimateRecoveryActivation,verifyRecoveryActivation} from './activation.js'

const archive = record => ({ ...record, history: undefined })
const historyOf = record => record && record.status !== 'READY'
  ? [...(record.history || []), archive(record)] : record?.history || []

export function createRecoveryController({ journal, rpcFactory, execution, importBackup,
  sign = execution.signRecoveryTransaction, now = Date.now } = {}) {
  const {assertRecoveryDescriptor,assertRecoveryPlan,assertRecoveryReplacement,descriptorDigest,prepareRecoveryPlan,
    prepareRecoveryReplacement,recoveryAttemptCandidates,recoverySafeHash,recoverySafeHashCall,requireRecoveryTest,
    safeInterface,verifyRecoveryReceipts}=execution
  let secret = null, descriptor = null, rpc = null, epoch = 0, unlockedAt = 0
  let timer = null
  const lock = () => {
    if (secret instanceof Uint8Array) secret.fill(0)
    epoch++; secret = null; unlockedAt = 0
    clearTimeout(timer); timer = null
  }
  const checkSession = token => {
    requireRecoveryTest(token === epoch && !!secret && now() - unlockedAt < 300000, 'RECOVERY_SESSION_LOCKED')
  }
  const setRpc = urls => { rpc = rpcFactory(urls) }
  const account = () => { requireRecoveryTest(descriptor, 'RECOVERY_FILE_REQUIRED'); return descriptor }
  const network = () => { requireRecoveryTest(rpc, 'TWO_RPC_SOURCES_REQUIRED'); return rpc }
  async function unlock(text, passphrase) {
    lock()
    const token = epoch
    requireRecoveryTest(typeof text === 'string' && new TextEncoder().encode(text).length <= 8192,
      'RECOVERY_FILE_INVALID')
    let restored
    try { restored = await importBackup(text, passphrase) }
    catch { throw new Error('RECOVERY_FILE_DECRYPTION_FAILED') }
    try {
    assertRecoveryDescriptor(restored.descriptor)
    requireRecoveryTest(token === epoch, 'RECOVERY_SESSION_LOCKED')
    const nextDescriptor = restored.descriptor
    await journal.withRecord(nextDescriptor.safeAddress, async ({ record, save }) => {
      requireRecoveryTest(!record || descriptorDigest(record.descriptor) === descriptorDigest(nextDescriptor),
        'RECOVERY_JOURNAL_ACCOUNT_MISMATCH')
      if (!record) await save({ version: 1, descriptor: nextDescriptor, plan: null, status: 'READY' })
    })
    requireRecoveryTest(token === epoch, 'RECOVERY_SESSION_LOCKED')
    descriptor = nextDescriptor; secret = restored.privateKey; restored.privateKey = null
    unlockedAt = now(); timer = setTimeout(lock, 300000)
    timer.unref?.()
    return descriptor
    } finally {
      if (restored.privateKey instanceof Uint8Array) restored.privateKey.fill(0)
      restored.privateKey = null
    }
  }
  async function openSaved(address) {
    lock()
    const record = await journal.read(address)
    requireRecoveryTest(record, 'NO_RECOVERY_RECORD')
    descriptor = record.descriptor
    return record
  }
  const read = () => journal.read(account().safeAddress)
  const check = options => network().state(account(),options)
  async function prepare({ action = 'withdraw', recipient, amount, asset,replacement = false } = {}) {
    if (typeof recipient === 'string') recipient = recipient.trim()
    if (typeof amount === 'string') amount = amount.trim()
    const token = epoch; checkSession(token)
    const currentDescriptor = account(), source = network()
    return journal.withRecord(currentDescriptor.safeAddress, async ({ record, save }) => {
      checkSession(token)
      let parent = null
      if (replacement) {
        parent = !record?.rawTransaction && record?.plan?.replacesTransactionHash
          ? record.history?.find(row => row.transactionHash === record.plan.replacesTransactionHash) : record
        requireRecoveryTest(parent, 'NO_RECOVERY_RECORD')
      } else requireRecoveryTest(!recoveryIsUnresolved(record), 'RECONCILE_EXISTING_RECOVERY_FIRST')
      const selectedAsset=replacement?parent.plan.asset:asset
      let state = await source.state(currentDescriptor,selectedAsset===undefined?undefined:{asset:selectedAsset,recipient})
      checkSession(token)
      if (action === 'deploy' && !replacement) {
        const deploymentGasLimit = await estimateRecoveryActivation({rpc:source,execution,descriptor:currentDescriptor,state})
        checkSession(token); state = {...state,deploymentGasLimit}
      }
      if (recoveryIsTerminal(record)) requireRecoveryTest(state.eoaNonce > BigInt(record.plan.eoaNonce),
        'PRIOR_RECOVERY_NONCE_NOT_CONFIRMED')
      const plan = replacement
        ? prepareRecoveryReplacement({ parent, descriptor: currentDescriptor, state, now: now() })
        : prepareRecoveryPlan({ descriptor: currentDescriptor, state, action, recipient, amount,asset,now: now() })
      const next = { version: 1, descriptor: currentDescriptor, plan, status: 'PREPARED', history: historyOf(record) }
      if (plan.action === 'deploy') {
        await verifyRecoveryActivation({rpc:source,execution,descriptor:currentDescriptor,state,plan})
        checkSession(token)
      }
      requireRecoveryTest(recoveryAttemptCandidates(next).length < 10, 'RECOVERY_REPLACEMENT_LIMIT')
      await save(next)
      return next
    })
  }
  async function submit(reviewHash, approved) {
    requireRecoveryTest(approved === true, 'EXPLICIT_APPROVAL_REQUIRED')
    const token = epoch; checkSession(token)
    const currentDescriptor = account(), source = network()
    try {
      return await journal.withRecord(currentDescriptor.safeAddress, async ({ record, save }) => {
        requireRecoveryTest(record?.status === 'PREPARED', 'RECOVERY_ALREADY_STARTED_OR_REVIEW_CHANGED')
        const state = await source.state(currentDescriptor,record.plan.asset===undefined?undefined:{asset:record.plan.asset,recipient:record.plan.recipient??undefined})
        checkSession(token)
        assertRecoveryPlan({ plan: record.plan, descriptor: currentDescriptor, state, reviewHash, now: now() })
        const parentRecord = record.plan.replacesTransactionHash
          ? record.history?.find(row => row.transactionHash === record.plan.replacesTransactionHash) : null
        if (parentRecord) assertRecoveryReplacement(record.plan, parentRecord)
        if (record.plan.action === 'deploy') {
          await verifyRecoveryActivation({rpc:source,execution,descriptor:currentDescriptor,state,plan:record.plan})
          checkSession(token)
        }
        if (record.plan.action !== 'deploy') {
          const callHash = safeInterface.decodeFunctionResult('getTransactionHash', await source.agree('eth_call', [{
            to: currentDescriptor.safeAddress, data: recoverySafeHashCall(record.plan)
          }, `0x${state.blockNumber.toString(16)}`]))[0]
          requireRecoveryTest(callHash === recoverySafeHash(record.plan), 'SAFE_HASH_DISAGREEMENT')
        }
        checkSession(token)
        return submitRecoveryAttempt({ record, save, reviewHash,
          sign: () => { checkSession(token); return sign({ privateKey: secret, descriptor: currentDescriptor,
            plan: record.plan, state, reviewHash, now: now(), parentRecord }) },
          broadcast: raw => {
            checkSession(token)
            return source.broadcastOnce(raw, record.plan.broadcastSource === 'secondary' ? 1 : 0)
          } })
      })
    } finally { lock() }
  }
  async function cancelReview() {
    return journal.withRecord(account().safeAddress, async ({ record, save }) => {
      requireRecoveryTest(['PREPARED', 'SIGNING'].includes(record?.status) && !record.plan.replacesTransactionHash &&
        !record.rawTransaction, 'RECONCILE_EXISTING_RECOVERY_FIRST')
      const next = { version: 1, descriptor: record.descriptor, plan: null, status: 'READY', history: record.history || [] }
      await save(next); return next
    })
  }
  async function reconcile() {
    const currentDescriptor = account(), source = network()
    return journal.withRecord(currentDescriptor.safeAddress, async ({ record, save }) => {
      requireRecoveryTest(record, 'NO_RECOVERY_RECORD')
      const candidates = record.plan ? recoveryAttemptCandidates(record) : []
      if (!candidates.length) return record
      requireRecoveryTest(await source.agree('eth_chainId', []) === '0x'+BigInt(currentDescriptor.chainId).toString(16), 'WRONG_NETWORK')
      let evidence = { status: 'UNKNOWN' }, winner = null
      for (const candidate of candidates) {
        const receipts = await Promise.all([0, 1].map(i => source.read(i, 'eth_getTransactionReceipt', [candidate.transactionHash])))
        if (!receipts.some(Boolean)) continue
        const blocks = receipts.every(Boolean) ? await Promise.all([0, 1].map(i =>
          source.read(i, 'eth_getBlockByNumber', [receipts[i].blockNumber, false]))) : []
        const heads = receipts.every(Boolean) ? await Promise.all([0, 1].map(i =>
          source.read(i, 'eth_getBlockByNumber', ['finalized', false]))) : []
        evidence = verifyRecoveryReceipts({ record: candidate, receipts, blocks, finalizedHeads: heads })
        if (evidence.status === 'UNKNOWN') continue
        if (candidate.plan.action === 'deploy' && evidence.executionSucceeded) requireRecoveryTest(
          await source.agree('eth_getCode', [currentDescriptor.safeAddress, receipts[0].blockNumber]) !== '0x',
          'DEPLOYMENT_NOT_VERIFIED')
        winner = candidate.transactionHash; break
      }
      if (!winner && record.status === 'PREPARED') return record
      const next = { ...record, ...evidence, resolvedByTransactionHash: winner, checkedAt: new Date(now()).toISOString() }
      await save(next); return next
    })
  }
  return { setRpc, unlock, lock, openSaved, read, check, prepare, submit, reconcile, cancelReview,
    list: journal.list, isUnlocked: () => !!secret && now() - unlockedAt < 300000 }
}
