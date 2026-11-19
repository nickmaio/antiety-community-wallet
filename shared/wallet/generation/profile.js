import { SAFE_PROXY_CREATION_CODE_HASH } from '../safeProxyCreationCode.js'

export const GENERATION_PROTOCOL = 'antiety-wallet-generation-v1'
// Fixed receiving range. Legacy descriptors retain their authenticated identity.
export const GENERATION_SLOT_COUNT = 65536
export const GENERATION_ROUTING_PROTOCOL = 'antiety-wallet-routing-v1'
export const GENERATION_STACK = Object.freeze({ safeVersion: '1.4.1',
  singleton: '0x41675C099F32341bf84BFc5382aF534df5C7461a',
  factory: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
  fallbackHandler: '0x0000000000000000000000000000000000000000', saltNonce: '0',
  proxyCodeHash: SAFE_PROXY_CREATION_CODE_HASH, profile: 'erc4337-v0.7',
  entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  module: '0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226',
  moduleSetup: '0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47' })
export const MAINNET_GENERATION_DERIVATION = 'fluidkey-1.1.1-mainnet-branch-3'
export const MAINNET_GENERATION_STACK = Object.freeze({...GENERATION_STACK,fallbackHandler:GENERATION_STACK.module})
const mainnetProfile = Object.freeze({chainId:1,derivation:MAINNET_GENERATION_DERIVATION,branch:3,
  stack:MAINNET_GENERATION_STACK,slotCounts:Object.freeze([GENERATION_SLOT_COUNT])})
export function generationNetworkProfile(network='ethereum-mainnet'){
  if(network!=='ethereum-mainnet')throw generationError('UNSUPPORTED_NETWORK')
  return mainnetProfile
}
export const generationError = code => new Error('WALLET_GENERATION_' + code)
export const exactFields = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === keys.split(',').sort().join(',')
const rootValid = root => root instanceof Uint8Array && root.length === 32

/** No wallet_poc dependency, sender IDs, server state, or passkey-derived wallet keys. */
export function createGenerationProfile(engine,network='ethereum-mainnet') {
  const {chainId,derivation,stack,slotCounts}=generationNetworkProfile(network)
  if (!engine || ['hashText','spendingPublicKey','validPublicKey','prepare','derive','dispose','privateAccount','predictAccount','signBinding',
    'exportRoutingParent','validRoutingParent','prepareRoutingParent']
    .some(key => typeof engine[key] !== 'function')) throw generationError('INVALID_ENGINE')
  const body = (publicKey, slotCount = GENERATION_SLOT_COUNT) => ({ protocol: GENERATION_PROTOCOL, derivation: derivation,
    chainId: chainId, slotCount,
    spendingPublicKey: publicKey, stack: stack })
  function normalizeDescriptor(value) {
    if (!exactFields(value, 'protocol,derivation,chainId,slotCount,spendingPublicKey,stack,generationId') ||
        value.protocol !== GENERATION_PROTOCOL || value.derivation !== derivation ||
        value.chainId !== chainId || !slotCounts.includes(value.slotCount) ||
        !/^0x04[0-9a-f]{128}$/.test(value.spendingPublicKey || '') || !engine.validPublicKey(value.spendingPublicKey) ||
        !exactFields(value.stack, Object.keys(stack).join(',')) ||
        Object.entries(stack).some(([key,expected]) => value.stack[key] !== expected)) throw generationError('INVALID_DESCRIPTOR')
    const descriptor = body(value.spendingPublicKey, value.slotCount)
    const generationId = engine.hashText(JSON.stringify(descriptor))
    if (generationId !== value.generationId) throw generationError('DESCRIPTOR_CHANGED')
    return Object.freeze({ ...descriptor, generationId })
  }
  function describe(root) {
    if (!rootValid(root)) throw generationError('INVALID_ROOT')
    const descriptor = body(engine.spendingPublicKey(root))
    return normalizeDescriptor({ ...descriptor, generationId: engine.hashText(JSON.stringify(descriptor)) })
  }
  function checkRoot(root, descriptor) {
    descriptor = normalizeDescriptor(descriptor)
    if (!rootValid(root) || engine.spendingPublicKey(root) !== descriptor.spendingPublicKey) throw generationError('ROOT_MISMATCH')
  }
  const slotGuard = slot => {
    if (!Number.isInteger(slot) || slot < 0 || slot >= GENERATION_SLOT_COUNT) throw generationError('RANGE_EXHAUSTED')
  }
  function normalizeDefaultAccount(descriptor,value) {
    descriptor = normalizeDescriptor(descriptor)
    if (!exactFields(value,'generationId,chainId,slot,owner,safeAddress,initializer') || value.generationId !== descriptor.generationId ||
        value.chainId !== chainId || value.slot !== 0) throw generationError('DEFAULT_ACCOUNT_INVALID')
    let prediction
    try { prediction = engine.predictAccount(value.owner) } catch { throw generationError('DEFAULT_ACCOUNT_INVALID') }
    if (value.owner !== prediction.owner || value.safeAddress !== prediction.safeAddress || value.initializer !== prediction.initializer) {
      throw generationError('DEFAULT_ACCOUNT_INVALID')
    }
    return Object.freeze({ generationId:descriptor.generationId,chainId:chainId,slot:0,...prediction })
  }
  function normalizeRoutingMaterial(value,descriptor) {
    descriptor = normalizeDescriptor(descriptor)
    if (!exactFields(value,'protocol,generationId,chainId,slotCount,descriptorHash,nodePrivateKey,nodeChainCode') ||
        value.protocol !== GENERATION_ROUTING_PROTOCOL || value.generationId !== descriptor.generationId ||
        value.chainId !== chainId || value.slotCount !== descriptor.slotCount ||
        value.descriptorHash !== engine.hashText(JSON.stringify(descriptor)) ||
        !/^0x[0-9a-f]{64}$/.test(value.nodePrivateKey || '') || !/^0x[0-9a-f]{64}$/.test(value.nodeChainCode || '') ||
        !engine.validRoutingParent(value)) throw generationError('ROUTING_MATERIAL_INVALID')
    return Object.freeze({protocol:GENERATION_ROUTING_PROTOCOL,generationId:descriptor.generationId,chainId:chainId,
      slotCount:descriptor.slotCount,descriptorHash:value.descriptorHash,nodePrivateKey:value.nodePrivateKey,nodeChainCode:value.nodeChainCode})
  }
  return Object.freeze({ protocol: GENERATION_PROTOCOL, chainId: chainId, slotCount: GENERATION_SLOT_COUNT,
    describe, normalizeDescriptor, normalizeDefaultAccount, checkRoot,
    normalizeRoutingMaterial,
    routingMaterialHash: (value,descriptor) => engine.hashText(JSON.stringify(normalizeRoutingMaterial(value,descriptor))),
    exportRoutingMaterial(material) {
      const descriptor=normalizeDescriptor(material?.descriptor)
      return normalizeRoutingMaterial({protocol:GENERATION_ROUTING_PROTOCOL,generationId:descriptor.generationId,
        chainId:chainId,slotCount:descriptor.slotCount,descriptorHash:engine.hashText(JSON.stringify(descriptor)),
        ...engine.exportRoutingParent(material)},descriptor)
    },
    async prepareRouting(value,descriptor,{checkpoint,assertStillActive} = {}) {
      if(typeof checkpoint !== 'function' || typeof assertStillActive !== 'function') throw generationError('INVALID_SCHEDULER')
      descriptor=normalizeDescriptor(descriptor);value=normalizeRoutingMaterial(value,descriptor)
      let material
      try {
        assertStillActive();material=await engine.prepareRoutingParent(value,descriptor,{checkpoint,assertStillActive})
        assertStillActive();return material
      }catch(error){if(material)engine.dispose(material);throw error}
    },
    hashBindingMessage: message => engine.hashText(message),
    signBinding(root,intent) {
      checkRoot(root,intent.descriptor)
      const account = normalizeDefaultAccount(intent.descriptor,intent.defaultAccount)
      return engine.signBinding(root,intent.descriptor,account,intent.message)
    },
    descriptorHash: value => engine.hashText(JSON.stringify(normalizeDescriptor(value))),
    async prepare(root, descriptor, { checkpoint, assertStillActive } = {}) {
      if (typeof checkpoint !== 'function' || typeof assertStillActive !== 'function') throw generationError('INVALID_SCHEDULER')
      descriptor = normalizeDescriptor(descriptor)
      // The engine validates the root while preparing shared HD prefixes cooperatively.
      if (!rootValid(root)) throw generationError('INVALID_ROOT')
      assertStillActive()
      const ownedRoot = root.slice()
      let material
      try {
        material = await engine.prepare(ownedRoot, descriptor, { checkpoint, assertStillActive })
        assertStillActive(); return material
      } catch (error) { if (material) engine.dispose(material); throw error }
      finally { ownedRoot.fill(0) }
    },
    account(material, slot) { slotGuard(slot); return engine.derive(material, slot) },
    dispose: material => engine.dispose(material),
    privateAccount(root, descriptor, slot) {
      slotGuard(slot); descriptor = normalizeDescriptor(descriptor); checkRoot(root, descriptor)
      return engine.privateAccount(root, descriptor, slot)
    },
  })
}
