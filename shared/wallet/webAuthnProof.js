const text = new TextEncoder();

export function base64url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function fromBase64url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url');
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

export function hex(bytes) {
  return `0x${Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function derP256SignatureToRaw(signature) {
  const bytes = new Uint8Array(signature);
  let offset = 0;
  const length = () => {
    if (offset >= bytes.length) throw new Error('Truncated signature');
    const first = bytes[offset++];
    if (first < 128) return first;
    if (first !== 0x81 || offset >= bytes.length) throw new Error('Unsupported signature length');
    const extended = bytes[offset++];
    if (extended < 128) throw new Error('Noncanonical signature length');
    return extended;
  };
  if (bytes[offset++] !== 0x30 || length() !== bytes.length - offset) throw new Error('Invalid P-256 signature');
  const integer = () => {
    if (bytes[offset++] !== 0x02) throw new Error('Invalid signature integer');
    const size = length();
    if (size < 1 || offset + size > bytes.length) throw new Error('Invalid signature integer length');
    let value = bytes.slice(offset, offset + size);
    offset += size;
    if (value[0] === 0 && value.length > 1) value = value.slice(1);
    if (value.length > 32) throw new Error('Signature integer is too large');
    const padded = new Uint8Array(32);
    padded.set(value, 32 - value.length);
    return padded;
  };
  const r = integer();
  const s = integer();
  if (offset !== bytes.length) throw new Error('Trailing signature bytes');
  const raw = new Uint8Array(64);
  raw.set(r);
  raw.set(s, 32);
  return raw;
}

/** Verify WebAuthn evidence; transaction authorization is checked by the caller. */
export async function verifyPasskeyAssertion({ assertion, challenge, rpId, origin, publicKeySpki,
  cryptography = globalThis.crypto }) {
  if (assertion.type !== 'public-key' || !assertion.response) throw new Error('Not a passkey assertion');
  const clientBytes = new Uint8Array(assertion.response.clientDataJSON);
  const client = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(clientBytes));
  if (client.type !== 'webauthn.get' || client.challenge !== base64url(challenge) || client.origin !== origin) {
    throw new Error('Passkey challenge or origin mismatch');
  }
  const auth = new Uint8Array(assertion.response.authenticatorData);
  if (auth.length < 37) throw new Error('Invalid authenticator data');
  const rpHash = new Uint8Array(await cryptography.subtle.digest('SHA-256', text.encode(rpId)));
  if (!auth.slice(0, 32).every((byte, index) => byte === rpHash[index])) throw new Error('Passkey RP ID mismatch');
  if ((auth[32] & 0x05) !== 0x05) throw new Error('User presence and verification are required');
  const clientHash = new Uint8Array(await cryptography.subtle.digest('SHA-256', clientBytes));
  const signed = new Uint8Array(auth.length + clientHash.length);
  signed.set(auth);
  signed.set(clientHash, auth.length);
  const publicKey = await cryptography.subtle.importKey('spki', publicKeySpki,
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const rawSignature = derP256SignatureToRaw(assertion.response.signature);
  if (!await cryptography.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, rawSignature, signed)) {
    throw new Error('Passkey signature is invalid');
  }
  return { signCount: new DataView(auth.buffer, auth.byteOffset + 33, 4).getUint32(0, false) };
}
