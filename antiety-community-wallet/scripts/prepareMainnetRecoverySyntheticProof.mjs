import {writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {createMainnetGenerationProfile} from '../../shared/wallet/generated/walletGenerationCrypto.js'
import {createGenerationRecoveryCodec} from '../../shared/wallet/generation/recovery.js'

// Public fixture: never fund or use as an actual wallet. No network requests.
if(!process.argv[2])throw Error('NEW_OUTPUT_FILE_REQUIRED')
const path=resolve(process.argv[2]),root=new Uint8Array(32).fill(91)
try{
  const profile=createMainnetGenerationProfile(),codec=createGenerationRecoveryCodec({profile})
  const serialized=await codec.exportBackup({root,passphrase:'public-synthetic-proof-only'})
  await writeFile(path,serialized,{flag:'wx'})
  console.log(JSON.stringify({stage:'mainnet-recovery-synthetic-file',status:'CREATED',chainId:1,
    publicSyntheticData:true,networkUsed:false,realWalletOrExportRead:false,signatureCreated:false,transactionSubmitted:false}))
}finally{root.fill(0)}
