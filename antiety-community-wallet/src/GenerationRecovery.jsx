import { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { formatEther, formatUnits } from 'ethers'
import { recoveryNetwork, recoveryNativeAmount, recoverySelectedAsset, recoveryPlanInput, recoveryPlanAmount } from './networkPresentation.js'
import { hasRecoveryEvidence, recoveryIsTerminal, recoveryRecordToResume } from './records.js'
import { recoveryErrorText, statusText, savedRecoveryRecordsError } from './messages.js'
import CompletedRecoveryReceipt from './CompletedRecoveryReceipt.jsx'
import GenerationSearchResults, { Funds } from './GenerationSearchResults.jsx'
import ConnectionSettings from './ConnectionSettings.jsx'
import RecoveryReference from './RecoveryReference.jsx'
import RecoveryOverview from './RecoveryOverview.jsx'
import { useRecoveryConnections } from './useRecoveryConnections.js'

const titles = {
  open: 'Recover Your Antiety Assets', search: 'Find Assets', account: 'Receiving Account', withdraw: 'Withdraw',
  unlock: 'Unlock Wallet', settings: 'Connection Settings', funding: 'Add ETH for network fees'
}
const actionTitles = { withdraw: 'Review Withdrawal', deploy: 'Review Activation', 'return-gas': 'Review fee reserve return' }
const connectionProblem = code => /^(?:RPC_|GENERATION_RECOVERY_RPC_|TWO_RPC_SOURCES_REQUIRED|WRONG_NETWORK|RECOVERY_CONNECTION_|RECOVERY_COOLDOWN_INVALID)/.test(code ?? '')

export default function GenerationRecovery({ controller, initialSources, connectionSettings }) {
  const chainId = controller.chainId ?? 1, network = recoveryNetwork(chainId), slotCount = controller.slotCount ?? 65536
  const eth = value => recoveryNativeAmount(value, chainId)
  const localConnections = useRecoveryConnections(initialSources, chainId), connections = connectionSettings || localConnections
  const currentConnections = useRef(connections)
  currentConnections.current = connections
  const [view, setView] = useState('open'), [settingsFrom, setSettingsFrom] = useState('open')
  const [unlockNext, setUnlockNext] = useState('account'), [fundingFrom, setFundingFrom] = useState('account')
  const [inventory, setInventory] = useState(null), [record, setRecord] = useState(null), [chain, setChain] = useState(null)
  const [file, setFile] = useState(null), [phrase, setPhrase] = useState(''), [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState(''), [problem, setProblem] = useState(null), [saved, setSaved] = useState([])
  const [progress, setProgress] = useState(null), [unlocked, setUnlocked] = useState(controller.isUnlocked()), [approved, setApproved] = useState(false)
  const [opening, setOpening] = useState(() => !controller.isUnlocked())
  const [assetKind, setAssetKind] = useState('native'), [recipient, setRecipient] = useState(''), [amount, setAmount] = useState('')
  const [clock, setClock] = useState(Date.now())
  const [senderEstimate, setSenderEstimate] = useState(''), [exhaustive, setExhaustive] = useState(false), [pausing, setPausing] = useState(false)
  const [direct, setDirect] = useState(false), [accountNumber, setAccountNumber] = useState('1'), [accountAddress, setAccountAddress] = useState('')
  const gate = useRef(false), epoch = useRef(0), fileInput = useRef(null), heading = useRef(null), stage = useRef(null)
  const selectedAsset = recoverySelectedAsset(chainId, assetKind)

  const configure = ({ persist = true } = {}) => {
    const preferences = currentConnections.current, settings = preferences.current()
    if (persist) preferences.persist()
    controller.setRpc(settings.sources); controller.setScanCooldown?.(settings.cooldownMs)
  }
  function clearInputs() {
    setPhrase(''); setFile(null); setRevealed(false)
    if (fileInput.current) fileInput.current.value = ''
  }
  function lock() {
    controller.lock(); clearInputs(); setUnlocked(false); setApproved(false)
  }
  function go(next) {
    setView(next); setProblem(null); setApproved(false)
  }
  function openSettings() {
    if (view === 'open' || view === 'unlock') clearInputs()
    if (view === 'open') setDirect(false)
    setSettingsFrom(view); setView('settings'); setApproved(false)
  }
  function askUnlock(next) {
    setUnlockNext(next); go('unlock')
  }
  function resetPayment(kind = 'native') {
    setAssetKind(kind); setRecipient(''); setAmount('')
  }
  function openWallet() {
    lock(); setRecord(null); setChain(null); setInventory(null); setDirect(false); resetPayment(); go('open')
  }
  async function perform(label, task, { retry, gasFrom, readAfterFailure = false } = {}) {
    if (gate.current) return
    gate.current = true; stage.current = null; setBusy(label); setProblem(null); setApproved(false); const token = epoch.current
    try { await task() } catch (cause) {
      if (token === epoch.current) {
        if (readAfterFailure) {
          const savedRecord = await Promise.resolve().then(() => controller.read()).catch(() => null)
          if (savedRecord) setRecord(savedRecord)
        }
        const code = cause?.code ?? cause?.message
        if (gasFrom && code === 'RECOVERY_OWNER_NEEDS_GAS') {
          setFundingFrom(gasFrom); setView('funding')
        } else {
          const connection = connectionProblem(code)
          const retryAction = retry ?? (connection && stage.current === 'wallet scan' ? () => findFunds() : undefined)
          setProblem({ message: recoveryErrorText(cause, stage.current, chainId), connection, retry: connection ? retryAction : undefined })
        }
      }
    } finally { gate.current = false; setBusy(''); setUnlocked(controller.isUnlocked()) }
  }
  async function refreshSaved() {
    stage.current = 'saved records'
    try { const rows = await controller.list(); setSaved(rows); return rows } catch (cause) { throw savedRecoveryRecordsError(cause) }
  }
  async function checkAccount() {
    stage.current = 'account chain check'
    try { setChain(await controller.check({ asset: recoverySelectedAsset(chainId, 'erc20') })) }
    catch (cause) {
      if (!['TOKEN_POLICY_CHANGED', 'TOKEN_TRANSFER_RESTRICTED'].includes(cause?.code ?? cause?.message)) throw cause
      const native = await controller.check({ asset: recoverySelectedAsset(chainId) })
      setChain(native)
    }
  }
  async function scan(options = {}) {
    setPausing(false); go('search')
    stage.current = 'wallet scan'; configure()
    if (options.restart) setInventory(null)
    setProgress({ scannedSlots: 0, totalSlots: slotCount })
    try {
      setInventory(await controller.discover(setProgress, { guided: !exhaustive, estimate: senderEstimate, ...options }))
    } catch (cause) {
      const partial = controller.inventory()
      if (partial) setInventory(partial)
      throw cause
    } finally { setProgress(null) }
  }
  function findFunds(options) {
    return perform('Searching receiving accounts…', () => scan(options), { retry: () => findFunds(options) })
  }
  function checkBalance() {
    return perform('Checking balances…', async () => { configure(); await checkAccount() }, { retry: checkBalance })
  }
  async function recover() {
    const selected = file, passphrase = phrase
    const savedRecord = view === 'unlock' && unlockNext !== 'search' ? record : null
    const target = direct && view === 'open' ? { slot: Number(accountNumber) - 1, address: accountAddress.trim() } : null
    setPhrase(''); setRevealed(false)
    if (!selected || selected.size > 4096) throw new Error('RECOVERY_FILE_INVALID')
    configure(); stage.current = 'file unlock'; const descriptor = await controller.unlock(await selected.text(), passphrase)
    clearInputs(); setUnlocked(controller.isUnlocked())
    if (savedRecord) {
      if (savedRecord.descriptor.generation.generationId !== descriptor.generationId) { controller.lock(); throw new Error('GENERATION_RECOVERY_ACCOUNT_MISMATCH') }
      stage.current = 'account selection'; setRecord(await controller.resumeAccount(savedRecord.descriptor.safeAddress))
      go(unlockNext)
      if (unlockNext !== 'transaction' || !savedRecord.plan) await checkAccount()
      return
    }
    setChain(null); setRecord(null); resetPayment()
    if (target) {
      stage.current = 'account selection'; setInventory(null)
      const row = await controller.unlockKnownAccount(target.slot, target.address)
      await showSelected(row)
      return
    }
    const cached = controller.inventory(); setInventory(cached ? { ...cached, lastKnown: true } : null)
    await scan()
  }
  async function showSelected(row) {
    setRecord(row); setChain(null); resetPayment(row.plan?.asset?.kind ?? 'native')
    if (row.plan && !recoveryIsTerminal(row)) {
      go('transaction')
      if (hasRecoveryEvidence(row)) await reconcile()
    } else {
      go('account'); await checkAccount()
    }
    await refreshSaved()
  }
  function select(slot) {
    return perform('Opening receiving account…', async () => {
      configure(); stage.current = 'account selection'
      await showSelected(await controller.selectAccount(slot))
    }, { retry: () => select(slot) })
  }
  async function openSaved(row, { automatic = false } = {}) {
    lock(); stage.current = 'saved records'
    const next = await controller.openSaved(row.descriptor.safeAddress)
    setInventory(null); setRecord(next); setChain(null); setOpening(false); resetPayment(next.plan?.asset?.kind ?? 'native')
    go(next.plan ? 'transaction' : 'account')
    if (hasRecoveryEvidence(next) && !recoveryIsTerminal(next)) {
      setBusy('Checking saved transaction…')
      await reconcile({ persist: !automatic })
    } else if (!next.plan && !automatic) {
      configure(); await checkAccount()
    }
  }
  function openSavedAccount(row) {
    return perform('Opening saved account…', () => openSaved(row), { retry: () => openSavedAccount(row) })
  }
  async function reconcile(options) {
    stage.current = 'transaction status'; configure(options)
    setRecord(await controller.reconcile()); await refreshSaved()
  }
  function checkStatus() {
    return perform('Checking transaction status…', () => reconcile(), { retry: checkStatus })
  }
  function prepare(action = 'withdraw', replacement = false) {
    return perform('Preparing transaction review…', async () => {
      configure()
      const asset = replacement ? record.plan.asset : action === 'withdraw' ? selectedAsset : recoverySelectedAsset(chainId)
      const value = action === 'return-gas' && !replacement ? formatEther(chain.entryPointDeposit) : amount
      setRecord(await controller.prepare({ action, recipient, amount: value, replacement, asset }))
      go('transaction'); await refreshSaved()
    }, { retry: () => prepare(action, replacement), gasFrom: view })
  }
  function refreshReview() {
    return perform('Refreshing network fee…', async () => {
      configure()
      setRecord(await controller.prepare(recoveryPlanInput(record.plan))); await refreshSaved()
    }, { retry: refreshReview, gasFrom: 'transaction' })
  }
  function submitReview() {
    const approval = approved
    return perform('Signing and submitting…', async () => {
      configure()
      try { setRecord(await controller.submit(record.plan.reviewHash, approval)) }
      finally { lock(); setChain(null); setInventory(value => value ? { ...value, lastKnown: true } : value) }
      await refreshSaved()
    }, { gasFrom: 'transaction', readAfterFailure: true })
  }
  function showAccount() {
    go('account')
    return checkBalance()
  }
  function cancelReview() {
    return perform('Discarding unsigned review…', async () => {
      const row = await controller.cancelReview()
      setRecord(row); go(view === 'transaction' && record.plan.action === 'withdraw' && unlocked && chain ? 'withdraw' : 'account')
      if (!chain) { configure(); await checkAccount() }
      await refreshSaved()
    })
  }
  function readSaved(isActive = () => true) {
    return perform('Opening wallet…', async () => {
      try {
        const rows = await refreshSaved(), previous = recoveryRecordToResume(rows)
        if (isActive() && previous) await openSaved(previous, { automatic: true })
      } finally { if (isActive()) setOpening(false) }
    }, { retry: () => stage.current === 'transaction status' ? checkStatus() : readSaved() })
  }

  useEffect(() => {
    let active = true
    if (controller.isUnlocked()) findFunds()
    else readSaved(() => active)
    const hidden = () => { if (document.hidden) { epoch.current++; lock() } }
    document.addEventListener('visibilitychange', hidden)
    const timer = setInterval(() => { setClock(Date.now()); setUnlocked(controller.isUnlocked()) }, 1000)
    return () => { active = false; epoch.current++; controller.lock(); clearInterval(timer); document.removeEventListener('visibilitychange', hidden) }
    // Each controller starts one recovery session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller])
  useEffect(() => { heading.current?.focus() }, [view])

  const plan = record?.plan, terminal = recoveryIsTerminal(record), review = record?.status === 'PREPARED'
  const expired = review && clock >= plan.expiresAt
  const reference = record?.resolvedByTransactionHash || record?.transactionHash || plan?.replacesTransactionHash
  const canReplace = !!record?.rawTransaction && ['SIGNED', 'UNKNOWN', 'ATTEMPTED', 'SUBMITTED'].includes(record.status)
  const interruptedUnsigned = record?.status === 'SIGNING' && !record.rawTransaction && !plan?.replacesTransactionHash
  const title = view === 'transaction' ? (review ? actionTitles[plan.action] : statusText[record.status]) : titles[view]
  const backToSearch = () => { setRecord(null); setChain(null); go('search') }
  const goBack = {
    search: openWallet,
    account: inventory ? backToSearch : openWallet,
    withdraw: () => go('account'),
    funding: () => go(fundingFrom),
    transaction: terminal ? undefined : inventory ? backToSearch : openWallet,
    unlock: () => { clearInputs(); go(unlockNext) },
    settings: () => setView(settingsFrom),
  }
  const backLabel = {
    search: 'Back to start', account: inventory ? 'Back to results' : 'Back to start', withdraw: 'Back to account',
    funding: 'Back', transaction: inventory ? 'Back to results' : 'Back to start',
    unlock: 'Back', settings: 'Back',
  }
  const currentAsset = assetKind === 'erc20' ? 'USDT' : 'ETH'
  const balance = assetKind === 'erc20' ? chain?.tokenBalance : chain?.safeBalance
  const available = balance == null ? null : formatUnits(balance, assetKind === 'erc20' ? 6 : 18)
  const accountAction = () => {
    if (!chain) return <button className="primary" disabled={!!busy} onClick={checkBalance}>Check balances</button>
    if (chain.recoveryBalance === 0n) return <button className="primary" disabled={!!busy} onClick={() => { setFundingFrom('account'); go('funding') }}>View funding address</button>
    if (!unlocked) return <button className="primary" disabled={!!busy} onClick={() => askUnlock('account')}>Unlock account</button>
    if (!chain.deployed) return <button className="primary" disabled={!!busy} onClick={() => prepare('deploy')}>Review activation</button>
    return <button className="primary" disabled={!!busy} onClick={() => go('withdraw')}>Withdraw</button>
  }

  return <main className="wallet-shell">
    <header className="wallet-header">
      <div className="wallet-identity">
        <img className="antiety-logo" src="./assets/antiety-logo.png" width={40} height={40} alt="" />
        <div><p className="brand">Antiety Community Wallet</p><p className="network">{network.name}</p></div>
      </div>
      <div className="header-actions">
        {unlocked && <button className="text-button" disabled={!!busy} onClick={lock}>Lock</button>}
        {view !== 'settings' && <button type="button" className="text-button settings-button" aria-label="Settings" title="Settings"
          disabled={!!busy} onClick={openSettings}>
          <svg aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
            <path d="M9.6 3h4.8l.5 2.3 1.4.8 2.3-.7L21 9.6l-1.8 1.6v1.6l1.8 1.6-2.4 4.2-2.3-.7-1.4.8-.5 2.3H9.6l-.5-2.3-1.4-.8-2.3.7L3 14.4l1.8-1.6v-1.6L3 9.6l2.4-4.2 2.3.7 1.4-.8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>}
      </div>
    </header>
    <div className="wallet-layout">
      <div className="wallet-workspace">
        {goBack[view] && <nav aria-label="Recovery"><button className="back text-button" disabled={!!busy}
          onClick={goBack[view]}><span aria-hidden="true">‹ </span>{backLabel[view]}</button></nav>}
        <section className="card" aria-labelledby="recovery-heading">
          <h1 id="recovery-heading" ref={heading} tabIndex={-1}>{title}</h1>
          {!!busy && !progress && <div className="loading" role="status"><span className="spinner" aria-hidden="true" />{busy}</div>}
          {problem && view !== 'settings' && <div className="notice error" role="alert">
            <p>{problem.message}</p>
            {problem.connection && <div className="actions">
              {problem.retry && <button className="primary" onClick={view === 'transaction' && !review ? checkStatus : problem.retry}>Retry</button>}
              <button className="text-button" onClick={openSettings}>Connection settings</button>
            </div>}
          </div>}
          {!opening && (view === 'open' || view === 'unlock') && <>
            <p className="lede">{view === 'open' ? 'Use your Antiety recovery file and its passphrase to look for your digital assets' :
              unlockNext === 'search' ? 'Use the original recovery file to continue the saved search' : 'Use the original recovery file to unlock this receiving account'}</p>
            <form className="fields" onSubmit={event => { event.preventDefault(); perform('Unlocking recovery file…', recover) }}>
              <label htmlFor="generation-file">Recovery file</label>
              <input id="generation-file" ref={fileInput} type="file" accept=".json,application/json" disabled={!!busy} onChange={event => setFile(event.target.files?.[0] || null)} />
              <label htmlFor="generation-phrase">Recovery passphrase</label>
              <div className="secret-input">
                <input id="generation-phrase" type={revealed ? 'text' : 'password'} value={phrase} autoComplete="off" spellCheck="false" maxLength={1024} disabled={!!busy} onChange={event => setPhrase(event.target.value)} />
                <button type="button" className="passphrase-toggle" aria-controls="generation-phrase"
                  aria-label={revealed ? 'Hide recovery passphrase' : 'Show recovery passphrase'} disabled={!!busy}
                  onMouseDown={event => event.preventDefault()} onClick={() => setRevealed(value => !value)}>
                  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12c2.4-4.4 5.8-7 10-7s7.6 2.6 10 7c-2.4 4.4-5.8 7-10 7s-7.6-2.6-10-7Z" />
                    <circle cx="12" cy="12" r="3" />
                    {revealed && <path d="m3 3 18 18" />}
                  </svg>
                </button>
              </div>
              {view === 'open' && <details className="disclosure" onToggle={event => { if (!event.currentTarget.open) setDirect(false) }}><summary>Search options</summary>
                <div className="search-options">
                  <div className="search-explanation">
                    <strong>Why scan receiving accounts?</strong>
                    <p>Antiety gives different payers different addresses to help keep your payments private. Each address is a receiving account. Your funds can be spread across those addresses, so recovery scans them for balances.</p>
                  </div>
                  <button type="button" className="secondary" disabled={!!busy} onClick={() => setDirect(value => !value)}>
                    {direct ? 'Back to scan options' : 'Open a known receiving account'}
                  </button>
                  {direct ? <>
                    <div className="field">
                      <label htmlFor="generation-account-number">Receiving account number</label>
                      <input id="generation-account-number" type="number" min="1" max={slotCount} step="1" value={accountNumber} disabled={!!busy} required onChange={event => setAccountNumber(event.target.value)} />
                    </div>
                    <div className="field">
                      <label htmlFor="generation-account-address">Receiving account address</label>
                      <input id="generation-account-address" value={accountAddress} disabled={!!busy} required autoComplete="off" spellCheck="false" onChange={event => setAccountAddress(event.target.value)} />
                    </div>
                  </> : <>
                    <div className="field">
                      <label htmlFor="generation-sender-estimate">Approximate number of senders (optional)</label>
                      <input id="generation-sender-estimate" type="number" min="0" max={slotCount - 1} step="1" value={senderEstimate}
                        aria-describedby="sender-estimate-help" disabled={!!busy} onChange={event => setSenderEstimate(event.target.value)} />
                      <p id="sender-estimate-help" className="muted">How many people have ever sent you digital assets or purchased from you through Antiety</p>
                    </div>
                    <label className="checkbox"><input type="checkbox" checked={exhaustive} disabled={!!busy} onChange={event => setExhaustive(event.target.checked)} />Check all {slotCount.toLocaleString('en-US')} accounts (lengthy)</label>
                  </>}
                </div>
              </details>}
              <button type="submit" className="primary recovery-submit" disabled={!!busy || !connections.valid || !file || phrase.length < 16}>
                {view === 'unlock' ? 'Unlock wallet' : direct ? 'Open receiving account' : 'Unlock Funds'}
              </button>
              {!connections.valid && <button type="button" className="text-button" onClick={openSettings}>Fix connection settings</button>}
            </form>
            {view === 'open' && saved.length > 0 && <details className="disclosure"><summary>Saved receiving accounts</summary>
              <ul className="account-list">{saved.map(row => <li key={row.descriptor.safeAddress}>
                <div>
                  <button type="button" className="account-title" disabled={!!busy} onClick={() => openSavedAccount(row)}>
                    Receiving account {row.descriptor.slot + 1}<span aria-hidden="true">›</span>
                  </button>
                  <RecoveryReference value={row.descriptor.safeAddress} label="receiving account address" compact />
                </div>
                <p className="muted">{row.plan ? statusText[row.status] : ''}</p>
              </li>)}</ul>
            </details>}
          </>}
          {view === 'search' && <GenerationSearchResults inventory={inventory} progress={progress} unlocked={unlocked} busy={!!busy} pausing={pausing} retrying={!!problem?.retry}
            onPause={() => { setPausing(true); controller.pauseSearch() }} onContinue={() => findFunds()} onUnlock={() => askUnlock('search')}
            onExhaustive={() => findFunds({ guided: false })} onRestart={() => findFunds({ restart: true })} onSelect={select} />}
          {view === 'account' && record && <>
            <RecoveryReference key={record.descriptor.safeAddress} value={record.descriptor.safeAddress} label="receiving account address" compact />
            {chain && <>
              <Funds eth={chain.safeBalance} usdt={chain.tokenBalance} />
              {chain.recoveryBalance === 0n ? <p className="notice">Add ETH to the recovery gas address to pay this account’s network fees.</p> :
                !chain.deployed && <p className="notice">Activate this receiving account on Ethereum before withdrawing.</p>}
            </>}
            {!problem && accountAction()}
            {terminal && <button className="text-button compact-action" disabled={!!busy} onClick={() => go('transaction')}>View last transaction</button>}
            {chain && <details className="disclosure"><summary>Account details</summary>
              <p className="muted">ETH held in the network fee reserve</p>
              <p>{eth(chain.entryPointDeposit)}</p>
              {chain.deployed && chain.entryPointDeposit > 0n && <button className="secondary" disabled={!!busy}
                onClick={() => unlocked ? prepare('return-gas') : askUnlock('account')}>{unlocked ? 'Return fee reserve' : 'Unlock to return fee reserve'}</button>}
            </details>}
          </>}
          {view === 'funding' && record && <>
            <p className="lede">Send ETH on Ethereum Mainnet to this recovery gas address, then check its balance.</p>
            <RecoveryReference value={record.descriptor.recoveryOwner} label="recovery gas address" />
            {chain && <p className="muted">Recovery gas balance · {eth(chain.recoveryBalance)}</p>}
            <button className="primary" disabled={!!busy} onClick={checkBalance}>Check balance</button>
            {!!chain && chain.recoveryBalance > 0n && <button className="text-button compact-action" disabled={!!busy}
              onClick={() => go(fundingFrom)}>Continue to {fundingFrom === 'withdraw' ? 'withdrawal' : fundingFrom === 'transaction' ? 'transaction' : 'account'}</button>}
          </>}
          {view === 'withdraw' && chain && <form className="fields" onSubmit={event => { event.preventDefault(); prepare() }}>
            <label htmlFor="generation-asset">Asset</label>
            <select id="generation-asset" value={assetKind} disabled={!!busy} onChange={event => { setAssetKind(event.target.value); setAmount('') }}>
              <option value="native">ETH</option><option value="erc20" disabled={chain.tokenBalance == null}>USDT</option>
            </select>
            <label htmlFor="generation-recipient">Destination address</label>
            <input id="generation-recipient" value={recipient} disabled={!!busy} autoComplete="off" spellCheck="false" onChange={event => setRecipient(event.target.value)} />
            <label htmlFor="generation-amount">Amount in {currentAsset}</label>
            <input id="generation-amount" value={amount} disabled={!!busy} inputMode="decimal" aria-describedby="available-balance" onChange={event => setAmount(event.target.value)} />
            <small className="muted" id="available-balance">{available == null ? 'Balance unavailable' : 'Available · ' + available + ' ' + currentAsset}</small>
            {unlocked ? <button className="primary" type="submit" disabled={!!busy || available == null || !recipient.trim() || !amount.trim()}>Review withdrawal</button> :
              <button type="button" className="primary" disabled={!!busy} onClick={() => askUnlock('withdraw')}>Unlock account</button>}
          </form>}
          {view === 'transaction' && plan && <>
            {terminal ? <CompletedRecoveryReceipt record={record} /> : <>
              <dl className="facts">
                {plan.action !== 'deploy' && <><dt>Amount</dt><dd className="transaction-amount">{recoveryPlanAmount(plan)}</dd></>}
                <dt>{plan.action === 'deploy' ? 'Receiving account' : plan.action === 'return-gas' ? 'Return to' : 'Destination'}</dt>
                <dd><RecoveryReference value={plan.recipient ?? record.descriptor.safeAddress} label={plan.recipient ? 'destination address' : 'receiving account address'} /></dd>
                <dt>Maximum network fee</dt><dd>{eth(plan.maximumFeeAtomic)}</dd>
                {reference && <><dt>Transaction reference</dt><dd><RecoveryReference value={reference} label="transaction reference" compact /></dd></>}
              </dl>
              {review && <>
                {expired && <p className="notice">The fee estimate expired. Refresh it before approving.</p>}
                {unlocked && !expired && <label className="checkbox approval"><input type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)} disabled={!!busy} />I approve this action and its maximum network fee.</label>}
                {!unlocked ? <button className="primary" disabled={!!busy} onClick={() => askUnlock('transaction')}>Unlock to continue</button> :
                  expired ? <button className="primary" disabled={!!busy} onClick={refreshReview}>Refresh fee</button> :
                    <button className="primary" disabled={!!busy || !approved} onClick={submitReview}>Approve and submit</button>}
                {!plan.replacesTransactionHash && <button className="text-button compact-action" disabled={!!busy} onClick={cancelReview}>
                  {plan.action === 'withdraw' && unlocked && chain ? 'Edit withdrawal' : 'Cancel review'}
                </button>}
              </>}
              {!review && hasRecoveryEvidence(record) && !problem?.retry && <button className="primary" disabled={!!busy} onClick={checkStatus}>Check status</button>}
              {interruptedUnsigned && <button className="primary" disabled={!!busy} onClick={cancelReview}>Discard unsigned review</button>}
              {review && hasRecoveryEvidence(record) && <button className="text-button compact-action" disabled={!!busy} onClick={checkStatus}>Check previous transaction</button>}
              {canReplace && <details className="disclosure"><summary>Transaction options</summary>
                <button className="secondary" disabled={!!busy} onClick={() => unlocked ? prepare(plan.action, true) : askUnlock('transaction')}>
                  {unlocked ? 'Review higher-fee replacement' : 'Unlock to review a higher-fee replacement'}
                </button>
              </details>}
            </>}
            {terminal && <button className="primary" disabled={!!busy} onClick={showAccount}>Back to account</button>}
          </>}
          {view === 'settings' && <ConnectionSettings connections={connections} busy={!!busy} />}
        </section>
      </div>
      <RecoveryOverview />
    </div>
    <footer>Recovery files, passphrases, and keys stay on this device.</footer>
  </main>
}
GenerationRecovery.propTypes = {
  controller: PropTypes.object.isRequired, initialSources: PropTypes.arrayOf(PropTypes.string).isRequired,
  connectionSettings: PropTypes.object
}
