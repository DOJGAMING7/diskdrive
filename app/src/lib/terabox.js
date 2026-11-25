import { withTimeout } from './async.js'

const TERABOX_HOSTS = new Set([
  'terabox.com','www.terabox.com','terabox.app','www.terabox.app',
  '1024terabox.com','www.1024terabox.com','4funbox.com','www.4funbox.com',
  'mirrobox.com','www.mirrobox.com','nephobox.com','www.nephobox.com',
  'teraboxlink.com','www.teraboxlink.com','teraboxshare.com','www.teraboxshare.com',
  'terasharelink.com','www.terasharelink.com','terafileshare.com','www.terafileshare.com',
  'momerybox.com','www.momerybox.com','tibibox.com','www.tibibox.com',
])

export function isTeraboxUrl(url='') {
  try { const u = new URL(String(url).trim()); return TERABOX_HOSTS.has(u.hostname.toLowerCase()) } catch { return false }
}

export function extractTeraboxLinks(text='') {
  const urls = String(text || '').match(/https?:\/\/[^\s<>"')\]]+/ig) || []
  return [...new Set(urls.map(u => u.replace(/[),.;!?]+$/g, '').trim()).filter(isTeraboxUrl))]
}

export async function resolveTeraboxLink(url, { resolverUrl, resolverKey } = {}) {
  const endpointBase = String(resolverUrl || '').trim().replace(/\/+$/, '')
  if (!endpointBase) throw new Error('Terabox resolver is not configured. Add Resolver URL in Settings.')
  const input = String(url || '').trim()
  if (!isTeraboxUrl(input)) throw new Error('Not a valid Terabox link.')

  const endpoint = endpointBase.endsWith('/resolve') ? endpointBase : `${endpointBase}/resolve`
  const headers = { 'Content-Type': 'application/json' }
  const key = String(resolverKey || '').trim()
  if (key) headers['X-Resolver-Key'] = key

  const res = await withTimeout(fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ url: input }),
  }), 30000, 'Terabox resolve')

  const data = await res.json().catch(() => null)
  if (!res.ok || !data) {
    const msg = data?.message || data?.error || `Resolver HTTP ${res.status}`
    throw new Error(msg)
  }
  if (data.ok === false) throw new Error(data.message || data.error || 'Resolve failed')

  const directUrl = String(data.directUrl || data.streamUrl || '').trim()
  if (!directUrl) throw new Error(data.message || 'No direct video link found for this Terabox share.')

  return {
    provider: 'TERABOX',
    kind: 'remote',
    title: String(data.name || data.title || 'Terabox video').replace(/\.[^.]+$/, ''),
    name: String(data.name || data.title || 'Terabox video'),
    src: directUrl,
    sourceUrl: String(data.sourceUrl || input),
    size: Number(data.size || 0) || 0,
    sizeHuman: String(data.sizeHuman || ''),
    date: String(data.date || ''),
    note: String(data.note || ''),
    resolvedAt: Date.now(),
  }
}
