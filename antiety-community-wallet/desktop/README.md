# Antiety Community Wallet for desktop

The desktop app runs the standalone Antiety recovery interface locally. Bring your original encrypted Antiety recovery file and its passphrase. The app connects directly to Ethereum Mainnet RPC providers to locate ETH and USDT and review transactions.

The desktop app has its own browser storage. To reopen a transaction started on the website, use that same website and browser profile. Keep your recovery file and passphrase for opening the wallet on another device or in the desktop app.

## Desktop builds

GitHub Actions builds installers on pull requests, pushes to main, and manual runs.

| Platform | Download |
| --- | --- |
| Windows x64 | NSIS installer (.exe) |
| Linux x64 | AppImage and Debian package (.deb) |
| macOS Apple Silicon | .dmg for arm64 |
| macOS Intel | .dmg for x64 |

Download installers from the workflow artifacts. A tag matching the desktop version in antiety-community-wallet/desktop/app/package.json creates a draft GitHub release after all four jobs succeed. The draft includes SHA256SUMS.txt. Review the installers before publishing.

The first builds are for testing. Windows installers are unsigned, and macOS builds use ad hoc signing. Developer ID signing and Apple notarization are needed for normal public macOS distribution. Windows code signing can be configured separately.

## Build or run locally

Install Node.js 24 and run these commands from antiety-community-wallet.

```sh
npm ci
npm --prefix desktop ci
npm run build
npm --prefix desktop run stage
npm --prefix desktop run start
```

Run npm --prefix desktop test to check the embedded wallet with a temporary profile. On a headless Linux host, run it through xvfb-run. Run npm --prefix desktop run package on the target operating system to build an installer. Installers are written to antiety-community-wallet/desktop/dist-desktop.

The repository includes the wallet source and the shared modules it requires. From the Antiety workspace, export a fresh source snapshot with npm run export:desktop -- <new-directory> from antiety-community-wallet. The export includes GitHub Actions and the dependency lockfiles.
