import { resolveTeraboxDirect, isTeraboxUrl, extractTeraboxLinks, normalizeTeraboxCookie } from './teraboxDirect.js'

export { isTeraboxUrl, extractTeraboxLinks, normalizeTeraboxCookie }

export async function resolveTeraboxLink(url, { teraboxCookie, ndus, signal, timeoutMs } = {}) {
  const input = String(url || '').trim()
  if (!isTeraboxUrl(input)) throw new Error('Not a valid Terabox link.')

  const cookie = normalizeTeraboxCookie(teraboxCookie || ndus)
  if (!cookie) throw new Error('Terabox NDUS/cookie missing. Add it in Settings (device-only).')
  return resolveTeraboxDirect(input, { cookie, signal, timeoutMs })
}
