import {useState} from 'react'
import PropTypes from 'prop-types'
import {formatUnits} from 'ethers'
import RecoveryReference from './RecoveryReference.jsx'

function Funds({eth,usdt}){
  return <dl className="funds">
    <div><dt>ETH</dt><dd>{formatUnits(eth,18)}</dd></div>
    <div><dt>USDT</dt><dd>{usdt==null?'Unavailable':formatUnits(usdt,6)}</dd></div>
  </dl>
}
Funds.propTypes={eth:PropTypes.oneOfType([PropTypes.string,PropTypes.bigint]).isRequired,
  usdt:PropTypes.oneOfType([PropTypes.string,PropTypes.bigint])}
export {Funds}

const pauseReasons={
  EMPTY_GAP:'The last 100 accounts were empty. You can continue searching.',
  TIME_BUDGET:'The search reached its time limit. Your progress is saved here.',
  CONNECTION:'A blockchain source stopped responding. You can continue from the saved progress.',
  VERIFICATION:'The blockchain snapshot could not be verified. Start a fresh search to verify the account list.',
  STORAGE:'The latest progress could not be saved. Verified results are still shown.',
}

export default function GenerationSearchResults({inventory,progress,unlocked,busy,pausing,retrying,onPause,onContinue,onUnlock,onExhaustive,onRestart,onSelect}){
  const [confirmRestart,setConfirmRestart]=useState(false)
  const found=progress?.scannedSlots===0&&inventory?inventory:(progress??inventory)
  if(!found)return <>
    <p className="muted">Continue the search to find your ETH and USDT.</p>
    {!retrying&&<button className="primary" disabled={busy} onClick={unlocked?onContinue:onUnlock}>{unlocked?'Continue search':'Unlock to continue'}</button>}
  </>
  const partial=!!progress||inventory.coverage==='PARTIAL'
  const waiting=!!progress&&!found.scannedSlots
  const accounts=progress?[]:inventory.accounts
  const summary=waiting?'Checking receiving accounts':partial?'Found so far':'Funds found'
  return <>
    <section aria-labelledby="search-summary">
      <h2 id="search-summary">{summary}</h2>
      {!waiting&&<Funds eth={found.nativeAtomic??'0'} usdt={found.tokenAtomic??'0'} />}
      <div className="search-progress">
        <progress aria-label="Receiving accounts checked" value={found.scannedSlots} max={found.totalSlots} />
        <p className="muted">{found.scannedSlots.toLocaleString('en-US')} of {found.totalSlots.toLocaleString('en-US')} accounts checked</p>
      </div>
      {progress?<button className="primary" disabled={pausing} onClick={onPause}>{pausing?'Saving progress…':'Pause search'}</button>:<>
        {inventory.lastKnown&&<p className="muted">Last verified results{inventory.snapshot?.blockNumber!=null?' at block '+inventory.snapshot.blockNumber.toLocaleString('en-US'):''}</p>}
        {partial&&<p className="muted">{pauseReasons[inventory.pauseReason]??'Search paused. Your progress is saved here.'}</p>}
        {partial&&!retrying&&!inventory.requiresFreshSearch&&<button className={accounts.length?'secondary':'primary'} disabled={busy}
          onClick={unlocked?onContinue:onUnlock}>{unlocked?'Continue search':'Unlock to continue'}</button>}
        {partial&&inventory.requiresFreshSearch&&<button className="secondary" disabled={busy} onClick={unlocked?()=>setConfirmRestart(true):onUnlock}>{unlocked?'Start a fresh search':'Unlock to search again'}</button>}
      </>}
    </section>
    {accounts.length>0&&<section className="section">
      <h2>Receiving accounts</h2>
      <ul className="account-list">{accounts.map(account=><li key={account.safeAddress}>
        <div>
          <button type="button" className="account-title" disabled={busy} onClick={()=>onSelect(account.slot)}>Receiving account {account.slot+1}<span aria-hidden="true">›</span></button>
          <RecoveryReference value={account.safeAddress} label={'receiving account '+(account.slot+1)+' address'} compact />
        </div>
        <p className="account-funds">{formatUnits(account.nativeAtomic,18)} ETH<br />{formatUnits(account.tokenAtomic,6)} USDT</p>
      </li>)}</ul>
    </section>}
    {!progress&&!partial&&!accounts.length&&<p className="muted">No ETH, USDT or accounts with fee reserves were found.</p>}
    {!progress&&unlocked&&<details className="disclosure" open={confirmRestart||undefined}>
      <summary>Search options</summary>
      <div className="secondary-actions">
        {partial&&!inventory.requiresFreshSearch&&<button type="button" className="text-button" disabled={busy} onClick={onExhaustive}>Check full range</button>}
        {!confirmRestart&&<button type="button" className="text-button" disabled={busy} onClick={()=>setConfirmRestart(true)}>Start a fresh search</button>}
      </div>
      {confirmRestart&&<div className="notice">
        <p>A fresh search starts at the first account and replaces the saved search progress for these sources.</p>
        <div className="actions">
          <button type="button" className="secondary" disabled={busy} onClick={()=>{setConfirmRestart(false);onRestart()}}>Start fresh search</button>
          <button type="button" className="text-button" disabled={busy} onClick={()=>setConfirmRestart(false)}>Keep current search</button>
        </div>
      </div>}
    </details>}
  </>
}
GenerationSearchResults.propTypes={inventory:PropTypes.object,progress:PropTypes.object,unlocked:PropTypes.bool.isRequired,busy:PropTypes.bool.isRequired,
  pausing:PropTypes.bool,retrying:PropTypes.bool,onPause:PropTypes.func,onContinue:PropTypes.func.isRequired,onUnlock:PropTypes.func,
  onExhaustive:PropTypes.func.isRequired,onRestart:PropTypes.func.isRequired,onSelect:PropTypes.func.isRequired}
