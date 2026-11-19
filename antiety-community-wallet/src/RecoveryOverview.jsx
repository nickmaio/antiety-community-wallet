export default function RecoveryOverview(){
  return <aside className="recovery-overview" aria-labelledby="overview-heading">
    <h2 id="overview-heading">What 'self-custodial' means?</h2>
    <p>If Antiety goes offline or is blocked in your region, you can use the Community Wallet to recover and transfer ETH and USDT on Ethereum Mainnet.</p>
    <dl className="overview-topics">
      <div>
        <dt>Independent access</dt>
        <dd>Run this wallet locally or host it yourself. It connects to Ethereum providers directly and works without an Antiety account or server.</dd>
      </div>
      <div>
        <dt>You control the keys</dt>
        <dd>A custodial platform holds the keys, so access depends on its security and withdrawal rules. With Antiety’s self-custodial wallet, your keys stay on your device and you approve transfers yourself.</dd>
      </div>
      <div>
        <dt>Keep your recovery file and passphrase</dt>
        <dd>You’ll need both to restore access. Store them securely and keep a local copy of the Community Wallet in case the website is unavailable.</dd>
      </div>
    </dl>
  </aside>
}
