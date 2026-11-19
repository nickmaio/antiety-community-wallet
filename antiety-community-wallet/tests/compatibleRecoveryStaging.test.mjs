import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,dirname,resolve,sep} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {stageCompatibleRecovery} from '../scripts/stage-compatible-recovery.mjs'

const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
test('staging retains approved origins and the audited proof and drops retired preview assets',async t=>{
  const parent=resolve(tmpdir()),base=await mkdtemp(join(parent,'antiety-recovery-staging-test-'))
  t.after(async()=>{assert(base.startsWith(parent+sep));await rm(base,{recursive:true,force:true})})
  const source=join(base,'source'),evidence=join(base,'evidence'),recovery=join(evidence,'candidate'),proof=join(base,'proof')
  const put=async(root,name,value)=>{const file=join(root,name);await mkdir(dirname(file),{recursive:true});await writeFile(file,value);return hash(Buffer.from(value))}
  await put(source,'wrangler.jsonc',JSON.stringify({name:'antiety',compatibility_date:'2026-01-01',main:'src/worker.mjs',assets:{directory:'./public',binding:'ASSETS'}}))
  await put(source,'public/index.html','old root')
  await put(source,'public/wallet-recovery-sepolia.zip','legacy archive')
  await put(source,'public/browser-wallet-handoff.html','legacy handoff')
  for(const name of ['assetlinks.json','assetlinks.antiety-development.json','apple-app-site-association'])await put(source,'public/.well-known/'+name,'{}')
  const cryptoHash=hash(await readFile(new URL('../../shared/wallet/generated/walletGenerationCrypto.js',import.meta.url)))
  const metadata={network:'Ethereum mainnet',chainIds:[1],sourceCryptoSha256:cryptoHash,slotCount:65536,antietyBackendRequired:false,antietyLoginIncluded:false}
  const recoveryFiles={}
  recoveryFiles['index.html']=await put(recovery,'index.html','new root')
  recoveryFiles['README.md']=await put(recovery,'README.md','synthetic')
  recoveryFiles['RECOVERY-BUILD.json']=await put(recovery,'RECOVERY-BUILD.json',JSON.stringify(metadata))
  recoveryFiles['favicon.ico']=await put(recovery,'favicon.ico','synthetic favicon')
  recoveryFiles['assets/antiety-logo.png']=await put(recovery,'assets/antiety-logo.png','synthetic logo')
  const sums=JSON.stringify({network:metadata.network,chainIds:metadata.chainIds,files:recoveryFiles}),sumsHash=await put(recovery,'SHA256SUMS.json',sums)
  const archiveHash=await put(evidence,'recovery.zip','synthetic archive')
  const qualification=join(base,'qualification.json')
  await writeFile(qualification,JSON.stringify({evidenceRoot:evidence,distribution:{directory:'candidate',archive:'recovery.zip',archiveSha256:archiveHash,
    packageVerification:{status:'PASSED',allPackageFilesVerified:true}},evidenceSha256:{'candidate/SHA256SUMS.json':sumsHash}}))
  const proofFiles={'production-wallet-origin-check.html':await put(proof,'production-wallet-origin-check.html','synthetic proof'),
    'assets/production-origin-check-test.js':await put(proof,'assets/production-origin-check-test.js','synthetic script'),
    'assets/production-origin-check-test.css':await put(proof,'assets/production-origin-check-test.css','synthetic style')}
  await put(proof,'PRODUCTION-ORIGIN-PROOF.json',JSON.stringify({kind:'synthetic-production-origin-vault-check',sourceOrigin:'https://wallet.antiety.com',targetOrigin:'https://antiety.com',rpId:'wallet.antiety.com',realWalletOrExportRead:false,backendCalls:false,files:proofFiles}))
  const out=join(base,'staged')
  await assert.rejects(stageCompatibleRecovery({source,qualification,out}),/proof is required/)
  await put(proof,'assets/production-origin-check-test.css','tampered')
  await assert.rejects(stageCompatibleRecovery({source,proof,qualification,out}),/proof changed after audit/)
  await put(proof,'assets/production-origin-check-test.css','synthetic style')
  await stageCompatibleRecovery({source,proof,qualification,out})
  const manifest=JSON.parse(await readFile(join(out,'STAGING.json')))
  assert.deepEqual(manifest.relatedOrigins,['https://preview.antiety.com','https://antiety.com'])
  assert.equal(manifest.files['production-wallet-origin-check.html'],proofFiles['production-wallet-origin-check.html'])
  const {default:worker}=await import(pathToFileURL(join(out,'src/worker.mjs')).href)
  const env={ASSETS:{fetch:async request=>new Response(await readFile(join(out,'public',new URL(request.url).pathname)))}}
  const origins=await worker.fetch(new Request('https://wallet.antiety.com/.well-known/webauthn'),env)
  assert.deepEqual((await origins.json()).origins,manifest.relatedOrigins)
  const check=await worker.fetch(new Request('https://wallet.antiety.com/production-wallet-origin-check'),env)
  assert.equal(await check.text(),'synthetic proof');assert.match(check.headers.get('content-security-policy'),/connect-src 'none'/)
  for(const [name,type] of [['favicon.ico','image/x-icon'],['assets/antiety-logo.png','image/png']]){
    assert.equal(manifest.files[name],recoveryFiles[name])
    const response=await worker.fetch(new Request('https://wallet.antiety.com/'+name),env)
    assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),type)
    assert.equal(hash(Buffer.from(await response.arrayBuffer())),recoveryFiles[name])
  }
  const verified=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/verify-compatible-recovery.mjs',import.meta.url)),out],{encoding:'utf8',timeout:20000})
  assert.equal(verified.status,0,verified.stderr);assert.equal(JSON.parse(verified.stdout).status,'PASSED')
  assert.equal(manifest.recoveryArchiveName,'wallet-recovery-ethereum.zip')
  assert.equal((await readFile(join(out,'public/wallet-recovery-ethereum.zip'))).toString(),'synthetic archive')
  for(const name of ['wallet-recovery-sepolia.zip','browser-wallet-handoff.html']){
    assert.equal(manifest.files[name],undefined)
    await assert.rejects(readFile(join(out,'public',name)),{code:'ENOENT'})
    assert.equal((await worker.fetch(new Request('https://wallet.antiety.com/'+name),env)).status,404)
  }
})
