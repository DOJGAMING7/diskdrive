export function withTimeout(promise, ms, label, { signal } = {}) {
  let t
  const timeout = new Promise((_, reject) => {
    const onAbort = () => reject(new Error(signal?.reason?.message || signal?.reason || 'Aborted'))
    if (signal?.aborted) return onAbort()
    signal?.addEventListener('abort', onAbort, { once: true })
    t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      reject(new Error(`Timeout: ${label}`))
    }, ms)
  })
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(t))
}
export function bootStatus(msg) {
  try { window.__diskdriveBootStatus?.(msg) } catch {}
  try { console.log('[DiskDrive]', msg) } catch {}
}
