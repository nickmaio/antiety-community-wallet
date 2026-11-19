# Antiety Community Wallet

Use your encrypted Antiety multi-account recovery file and its original passphrase to recover ETH and USDT on Ethereum Mainnet. The wallet runs in your browser and connects directly to two independent Ethereum RPC providers. It requires no Antiety account, passkey, backend or bundler.

## Run locally

1. Download and extract the [Community Wallet ZIP](https://wallet.antiety.com/wallet-recovery-ethereum.zip).
2. Install a current Node.js LTS release. Run `start.cmd` on Windows, or open a terminal in the extracted directory and run `node start.mjs`.
3. Open [http://127.0.0.1:18747](http://127.0.0.1:18747) in a current browser with Web Crypto, IndexedDB and Web Locks. Keep the terminal open while using the wallet. Continue using that exact address to reopen your saved records.

## Deploy to Vercel or another static host

1. Extract the ZIP and copy `index.html`, `favicon.ico` and the entire `assets/` directory into a folder for publishing. Keep `index.html` and `favicon.ico` at the folder root. You can include this README. The launchers are for local use.
2. On Vercel, drag the folder into **Vercel Drop** and deploy it as a static site. On another provider, upload the same folder as the site's document root and serve it over HTTPS. The packaged `_headers` file contains the HTTP headers for hosts that support that format. Configure equivalent headers through your provider when needed. [Vercel deployment guide](https://vercel.com/docs/deployments#vercel-drop)
3. Use a stable HTTPS domain so the browser can reopen saved transactions between deployments. If you use custom RPC endpoints, configure your providers to accept browser requests from that domain or from your localhost origin.

### Build from source

From the repository's `antiety-community-wallet` directory, run `npm ci` and then `npm run build`. The build uses the repository's sibling `shared/` directory for wallet libraries and the verified crypto bundle. The package is written to `dist-wallet-recovery/`. Run `npm run preview` to open the built wallet locally, `npm test` to run its tests, or publish the static files using the instructions above.

## Recover funds

1. Select your encrypted recovery file, enter its passphrase, and choose **Unlock Funds**. Use **Search options** to open a known receiving account by number and address.
2. Select a receiving account, choose **Withdraw**, and select the asset. If a provider is unavailable, open **Connection settings** from the error or the header.
3. Fund the account's recovery gas address with ETH if prompted. Review account activation if required, then review the withdrawal destination, amount and maximum network fee before approving.
4. Reopen the same site in the same browser profile to continue. The wallet restores your saved transaction status and checks unresolved transactions against both providers. It only signs and broadcasts after you unlock the account and explicitly approve a review.

Transaction records and search progress are kept in IndexedDB for this site and browser profile. Clearing the site's data, switching profiles, or moving to a different domain or port prevents that installation from reopening the saved history. Keep your original encrypted recovery file and passphrase. The wallet never uploads or keeps a browser copy of either, and it holds keys in memory only while unlocked. Connection settings, including any RPC API keys you enter, are stored in this browser.
