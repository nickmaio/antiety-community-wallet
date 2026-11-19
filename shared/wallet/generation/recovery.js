import { base64url, fromBase64url } from '../webAuthnProof.js'
import { exactFields, generationError, GENERATION_PROTOCOL } from './profile.js'

const encoder = new TextEncoder(), iterations = 600000
const fail = code => { throw generationError(code) }
function decode(value, size) {
  if (typeof value !== 'string' || value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) fail('INVALID_ENCODING')
  const bytes = fromBase64url(value)
  if (bytes.length !== size || base64url(bytes) !== value) fail('INVALID_ENCODING')
  return bytes
}
async function keyFor(passphrase, salt, usage, cryptography) {
  if (typeof passphrase !== 'string' || passphrase.length < 16 || passphrase.length > 1024) fail('INVALID_PASSPHRASE')
  const bytes = encoder.encode(passphrase)
  try {
    if (bytes.length > 2048) fail('INVALID_PASSPHRASE')
    const key = await cryptography.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey'])
    return await cryptography.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key,
      { name: 'AES-GCM', length: 256 }, false, [usage])
  } finally { bytes.fill(0) }
}

/** New generation format only. Legacy Safe v2/v3 and proof files retain their own decoders. */
export function createGenerationRecoveryCodec({ profile, cryptography = globalThis.crypto }) {
  if (typeof profile?.describe !== 'function' || !cryptography?.subtle || !cryptography?.getRandomValues) fail('INVALID_SETUP')
  function inspect(serialized) {
    if (typeof serialized !== 'string' || encoder.encode(serialized).length > 4096) fail('INVALID_EXPORT')
    let value
    try { value = JSON.parse(serialized) } catch { fail('INVALID_EXPORT') }
    if (!exactFields(value, 'protocol,descriptor,kdf,cipher') || value.protocol !== GENERATION_PROTOCOL ||
        !exactFields(value.kdf, 'name,iterations,salt') || !exactFields(value.cipher, 'name,iv,ciphertext') ||
        value.kdf.name !== 'PBKDF2-SHA256' || value.kdf.iterations !== iterations || value.cipher.name !== 'AES-256-GCM') fail('INVALID_EXPORT')
    const descriptor = profile.normalizeDescriptor(value.descriptor)
    decode(value.kdf.salt,16); decode(value.cipher.iv,12); decode(value.cipher.ciphertext,48)
    return Object.freeze({ protocol: GENERATION_PROTOCOL, descriptor,
      kdf: Object.freeze({ name: value.kdf.name, iterations, salt: value.kdf.salt }),
      cipher: Object.freeze({ name: value.cipher.name, iv: value.cipher.iv, ciphertext: value.cipher.ciphertext }) })
  }
  const aad = descriptor => encoder.encode(JSON.stringify({ protocol: GENERATION_PROTOCOL, descriptor }))
  return Object.freeze({ inspect,
    async exportBackup({ root, passphrase, descriptor: originalDescriptor }) {
      const descriptor = originalDescriptor ? profile.normalizeDescriptor(originalDescriptor) : profile.describe(root)
      profile.checkRoot(root,descriptor)
      const ownedRoot = root.slice()
      try {
        const salt = cryptography.getRandomValues(new Uint8Array(16)), iv = cryptography.getRandomValues(new Uint8Array(12))
        const key = await keyFor(passphrase,salt,'encrypt',cryptography)
        const ciphertext = await cryptography.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(descriptor), tagLength: 128 }, key, ownedRoot)
        return JSON.stringify({ protocol: GENERATION_PROTOCOL, descriptor,
          kdf: { name: 'PBKDF2-SHA256', iterations, salt: base64url(salt) },
          cipher: { name: 'AES-256-GCM', iv: base64url(iv), ciphertext: base64url(ciphertext) } })
      } finally { ownedRoot.fill(0) }
    },
    async importBackup({ serialized, passphrase }) {
      const value = inspect(serialized)
      const key = await keyFor(passphrase,decode(value.kdf.salt,16),'decrypt',cryptography)
      let root
      try {
        try { root = new Uint8Array(await cryptography.subtle.decrypt({ name: 'AES-GCM', iv: decode(value.cipher.iv,12),
          additionalData: aad(value.descriptor), tagLength: 128 }, key, decode(value.cipher.ciphertext,48))) }
        catch { fail('CANNOT_DECRYPT') }
        profile.checkRoot(root,value.descriptor)
        return { root, descriptor: value.descriptor }
      } catch (error) { root?.fill(0); throw error }
    },
  })
}
