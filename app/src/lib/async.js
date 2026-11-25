export function withTimeout(promise, ms, label) {
  let t
  const timeout = new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`Timeout: ${label}`)), ms) })
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(t))
}
export function bootStatus(msg) {
  try { window.__diskdriveBootStatus?.(msg) } catch {}
  try { console.log('[DiskDrive]', msg) } catch {}
}
