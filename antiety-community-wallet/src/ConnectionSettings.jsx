import PropTypes from 'prop-types'

export default function ConnectionSettings({connections,busy=false}){
  const {draft,status}=connections
  const message={
    saved:'Saved in this browser',
    editing:'Saving changes…',
    invalid:'Enter two HTTPS URLs from different providers and a wait between 0.25 and 60 seconds.',
    unavailable:'Browser storage is unavailable. Changes may be lost when you close the page.',
  }[status]
  return <>
    <p className="lede">Use two independent Ethereum Mainnet providers to verify balances and transactions.</p>
    <div className="fields">
      {draft.sources.map((url,index)=><div className="field" key={index}>
        <label htmlFor={'source-'+index}>Provider {index+1} HTTPS URL</label>
        <input id={'source-'+index} type="url" autoComplete="off" spellCheck="false" value={url}
          disabled={busy} onBlur={connections.persist} onChange={event=>connections.update({...draft,
            sources:draft.sources.map((value,position)=>position===index?event.target.value:value)})} />
      </div>)}
      <label htmlFor="recovery-cooldown">Wait between scan requests (seconds)</label>
      <input id="recovery-cooldown" type="number" min="0.25" max="60" step="0.25" inputMode="decimal" value={draft.cooldownSeconds}
        disabled={busy} onBlur={connections.persist} onChange={event=>connections.update({...draft,cooldownSeconds:event.target.value})} />
      {message&&<p className="muted" role="status">{message}</p>}
      <button type="button" className="secondary" disabled={busy} onClick={connections.reset}>Restore default settings</button>
    </div>
    <details className="disclosure">
      <summary>Connection help</summary>
      <ul className="help">
        <li>Copy the full HTTPS RPC URL from each Ethereum provider. If browser access is restricted, allow this page’s address in the provider settings.</li>
        <li>If a provider limits requests, increase the wait. Changing the wait preserves progress. Changing a provider starts a separate search for those sources.</li>
        <li>URLs may contain API keys. They’re saved in this browser.</li>
      </ul>
    </details>
  </>
}

ConnectionSettings.propTypes={connections:PropTypes.object.isRequired,busy:PropTypes.bool}
