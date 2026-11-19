const databaseName = 'antiety-independent-generation-mainnet-recovery-v1'
const storeName = 'wallets'

export function createRecoveryJournal({ indexedDB = globalThis.indexedDB, locks = globalThis.navigator?.locks,
  databaseName: name = databaseName, assertRecord,chainId=1 } = {}) {
  if(chainId!==1)throw new Error('WRONG_NETWORK')
  const keyFor=address=>`${chainId}:${address.toLowerCase()}`
  let opening
  function database() {
    if (!indexedDB) throw new Error('RECOVERY_STORAGE_UNAVAILABLE')
    if (!opening) {
      let pending
      pending = new Promise((resolve, reject) => {
        let finished = false
        const request = indexedDB.open(name, 1)
        const failed = () => { finished = true; reject(new Error('RECOVERY_STORAGE_UNAVAILABLE')) }
        request.onupgradeneeded = () => request.result.createObjectStore(storeName)
        request.onerror = request.onblocked = failed
        request.onsuccess = () => {
          const db = request.result
          // An open can succeed after its blocked notification already rejected.
          if (finished) { db.close(); return }
          finished = true
          const forget = () => { if (opening === pending) opening = null }
          db.onversionchange = () => { forget(); db.close() }
          db.onclose = forget
          resolve(db)
        }
      }).catch(() => {
        if (opening === pending) opening = null
        throw new Error('RECOVERY_STORAGE_UNAVAILABLE')
      })
      opening = pending
    }
    return opening
  }
  async function transact(mode, work) {
    const db = await database()
    return new Promise((resolve, reject) => {
      let result
      let transaction
      const failed = () => reject(new Error(mode === 'readwrite' ? 'RECOVERY_STORAGE_WRITE_FAILED' : 'RECOVERY_STORAGE_UNAVAILABLE'))
      try {
        transaction = db.transaction(storeName, mode,
          mode === 'readwrite' ? { durability: 'strict' } : undefined)
        transaction.oncomplete = () => resolve(result)
        transaction.onerror = transaction.onabort = failed
        work(transaction.objectStore(storeName), value => { result = value })
      } catch {
        try { transaction?.abort() } catch { /* A finished transaction cannot be aborted. */ }
        failed()
      }
    })
  }
  async function read(address) {
    const row = await transact('readonly', (store, done) => {
      store.get(keyFor(address)).onsuccess = event => done(event.target.result || null)
    })
    return row ? assertRecord(row) : null
  }
  const list = async () => {
    const rows = await transact('readonly', (store, done) => {
      store.getAll().onsuccess = event => done(event.target.result)
    })
    return rows.map(row => assertRecord(row))
  }
  async function withRecord(address, task) {
    if (!locks?.request) throw new Error('RECOVERY_BROWSER_LOCK_UNAVAILABLE')
    // A single lock also serializes shared recovery-owner nonces across accounts.
    return locks.request('antiety-independent-recovery-write', { ifAvailable: true }, async lock => {
      if (!lock) throw new Error('RECOVERY_OTHER_TAB_ACTIVE')
      const record = await read(address)
      const save = async value => {
        assertRecord(value)
        if (keyFor(value.descriptor.safeAddress) !== keyFor(address)) throw new Error('RECOVERY_JOURNAL_ACCOUNT_MISMATCH')
        // Complete the IndexedDB transaction before signing or starting transport.
        await transact('readwrite', store => store.put(value, keyFor(address)))
      }
      return task({ record, save })
    })
  }
  return { read, list, withRecord }
}
