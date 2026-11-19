# Antiety Community Wallet

Antiety Community Wallet is a **standalone, self-custodial recovery wallet for Antiety funds**. Use it to find and withdraw ETH and USDT on Ethereum Mainnet if the main Antiety app goes offline or is blocked in your region. You’ll need your encrypted Antiety recovery file, its passphrase, and an internet connection to Ethereum RPC providers.

This public repository contains the browser wallet and its desktop app for Windows, Linux, and macOS. Both connect directly to Ethereum and work without an Antiety account, passkey, or server. The recovery file, passphrase, and private keys stay on your device.

## Get the wallet

- **Browser.** Open the [hosted Community Wallet](https://wallet.antiety.com/). You can also keep a [local browser copy](https://wallet.antiety.com/wallet-recovery-ethereum.zip) or [host it yourself](https://github.com/nickmaio/antiety-community-wallet/blob/main/antiety-community-wallet/BROWSER.md#deploy-to-vercel-or-another-static-host).
- **Desktop.** Download the installer for your platform from the [latest GitHub release](https://github.com/nickmaio/antiety-community-wallet/releases/latest). To try a newer build from `main`, sign in to GitHub and download the ZIP for your platform under **Artifacts** in the latest successful [Desktop builds](https://github.com/nickmaio/antiety-community-wallet/actions/workflows/desktop.yml?query=branch%3Amain) run.

| Platform | Installer |
| --- | --- |
| Windows x64 | `.exe` |
| Linux x64 | `.AppImage` or `.deb` |
| macOS Apple Silicon | ARM64 `.dmg` |
| macOS Intel | x64 `.dmg` |

Windows installers are unsigned. macOS installers use ad hoc signing and lack Apple notarization. Use `SHA256SUMS.txt` from the release to verify your download.

## What you can do

- **Find funds across receiving accounts.** Antiety uses different receiving addresses to help keep payments private. Scan for ETH and USDT across those addresses, check all 65,536 accounts if needed, or open a known receiving account by number and address.
- **Review and withdraw.** See balances, choose a destination and amount, and review network fees before approving a withdrawal. The wallet guides you through funding ETH for network fees and activating a receiving account when required. It checks on-chain data against two independent RPC providers, which you can change in **Connection Settings**.
- **Pick up where you left off.** The wallet saves search progress and transaction status locally. Reopen the same desktop installation or the same website in the same browser profile to resume. The browser and desktop versions keep separate records, and clearing site data removes the browser copy.

To start, select your recovery file, enter the passphrase, and choose **Unlock Funds**. Keep the original file and passphrase for use on another device or installation.

## Build from source

Install Node.js 24. From the repository root, run:

```sh
cd antiety-community-wallet
npm ci
npm test
npm run build
```

The browser build is written to `antiety-community-wallet/dist-wallet-recovery/` relative to the repository root. Run `npm run preview` from `antiety-community-wallet` to serve it locally. See the [browser wallet guide](https://github.com/nickmaio/antiety-community-wallet/blob/main/antiety-community-wallet/BROWSER.md) for local ZIP and static hosting instructions.

To launch the desktop app from the same directory:

```sh
npm --prefix desktop ci
npm --prefix desktop run stage
npm --prefix desktop run start
```

Run `npm --prefix desktop test` to check the desktop app with a temporary profile. On headless Linux, run it through `xvfb-run`. Run `npm --prefix desktop run package` on the target operating system to build an installer. Desktop installers are written to `antiety-community-wallet/desktop/dist-desktop/` relative to the repository root.

## Desktop build automation

GitHub Actions builds installers on pull requests, pushes to `main`, and manual runs. A tag matching the version in [`desktop/app/package.json`](https://github.com/nickmaio/antiety-community-wallet/blob/main/antiety-community-wallet/desktop/app/package.json), such as `v0.1.0`, creates a **draft** release after all four builds pass. The draft includes the installers and `SHA256SUMS.txt` for verification before publication.
