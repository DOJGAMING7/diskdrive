import { withTimeout } from './async.js'

const UA = 'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'

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

export function normalizeTeraboxCookie(input='') {
  const raw = String(input || '').trim()
  if (!raw) return ''
  if (/ndus=/i.test(raw) || /;/ .test(raw) || /=/.test(raw)) return raw
  // assume plain ndus value
  return `ndus=${raw}`
}

function parseSurl(url) {
  const u = new URL(String(url).trim())
  let raw = (u.searchParams.get('surl') || '').trim()
  if (!raw) {
    const m = u.pathname.match(/\/s\/([A-Za-z0-9_-]+)/)
    if (m) raw = m[1]
  }
  const pwd = (u.searchParams.get('pwd') || u.searchParams.get('password') || '').trim()
  if (!raw) throw new Error('Could not extract Terabox share ID from link')
  const clean = raw.replace(/^1/, '')
  const candidates = []
  const push = (s) => { s = String(s || '').trim(); if (s && !candidates.includes(s)) candidates.push(s) }
  push(raw); push(clean); push(`1${clean}`)
  return { surl: clean, candidates, pwd, shareUrl: `https://${u.hostname}/sharing/link?surl=${clean}` }
}

function humanSize(size) {
  const n = Number(size)
  if (!Number.isFinite(n) || n < 0) return ''
  const units = ['B','KB','MB','GB','TB']
  let v = n
  for (const unit of units) {
    if (v < 1024 || unit === 'TB') return unit === 'B' ? `${Math.round(v)} B` : `${v.toFixed(2)} ${unit}`
    v /= 1024
  }
  return `${n} B`
}

function pickDate(file) {
  const raw = file?.server_mtime || file?.local_mtime || file?.server_ctime || file?.local_ctime
  const n = Number(raw); if (!Number.isFinite(n) || n <= 0) return ''
  try { return new Date(n < 1e12 ? n * 1000 : n).toISOString().slice(0, 10) } catch { return '' }
}

function pickThumb(file) {
  const thumbs = file?.thumbs || file?.thumb || {}
  if (typeof thumbs === 'string') return thumbs
  return String(thumbs.url3 || thumbs.url2 || thumbs.url1 || thumbs.icon || file?.thumb || '')
}

function mapResult(file, sourceUrl, note='') {
  const directUrl = String(file?.dlink || '').trim()
  const size = Number(file?.size) || 0
  const name = String(file?.server_filename || file?.filename || file?.name || 'Terabox video')
  return {
    provider: 'TERABOX',
    kind: 'remote',
    title: name.replace(/\.[^.]+$/, ''),
    name,
    src: directUrl,
    directUrl,
    downloadUrl: directUrl,
    proxyDownloadUrl: '',
    proxyStreamUrl: '',
    sourceUrl,
    size,
    sizeHuman: humanSize(size),
    thumb: pickThumb(file),
    date: pickDate(file),
    uploader: String(file?.owner_name || file?.uname || file?.username || ''),
    note: String(note || ''),
    resolvedAt: Date.now(),
  }
}

async function fetchJson(url, opts={}) {
  const res = await withTimeout(fetch(url, opts), 30000, 'Terabox request')
  const text = await res.text()
  try { return JSON.parse(text) } catch { return { _nonJson: true, _status: res.status, _text: text.slice(0, 160) } }
}

function buildHeaders(cookie, referer='https://www.terabox.com/') {
  const h = {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Referer': referer,
  }
  if (cookie) h['Cookie'] = cookie
  return h
}

async function getSharePageInfo(shareUrl, cookie) {
  const res = await withTimeout(fetch(shareUrl, { headers: buildHeaders(cookie), redirect: 'follow' }), 30000, 'Terabox share page')
  const text = await res.text()
  const pick = (re) => { const m = text.match(re); return m ? m[1] : '' }
  return {
    jsToken: pick(/fn\("([a-fA-F0-9]+)"\)/) || pick(/"jsToken"\s*:\s*"([^"]+)"/) || pick(/fn%28%22(.*?)%22%29/) || '',
    sign: pick(/"sign"\s*:\s*"([^"]+)"/),
    timestamp: pick(/"timestamp"\s*:\s*"?(\d+)"?/),
    shareid: pick(/"shareid"\s*:\s*"?(\d+)"?/),
    uk: pick(/"uk"\s*:\s*"?(\d+)"?/),
    seckey: pick(/"seckey"\s*:\s*"([^"]+)"/),
  }
}

async function verifyShare(surl, pwd, cookie, host='www.terabox.com') {
  if (!pwd) return
  const params = new URLSearchParams({ app_id: '250528', surl: `1${String(surl).replace(/^1/, '')}`, pwd })
  await withTimeout(fetch(`https://${host}/share/verify?${params}`, { headers: buildHeaders(cookie, `https://${host}/`) }), 20000, 'Terabox verify').catch(() => {})
}

async function listShareRaw(surl, jsToken, cookie, dir=null, host='www.terabox.com') {
  const params = new URLSearchParams({
    app_id: '250528', web: '1', channel: 'dubox', clienttype: '0',
    jsToken: jsToken || '', shorturl: String(surl).replace(/^1/, ''), page: '1', num: '1000', by: 'name', order: 'asc',
  })
  if (dir) params.set('dir', dir); else params.set('root', '1')
  return fetchJson(`https://${host}/share/list?${params}`, { headers: buildHeaders(cookie, `https://${host}/`) })
}

async function collectFiles(surl, jsToken, cookie, entries, host='www.terabox.com') {
  const files = []
  for (const item of entries || []) {
    if (String(item.isdir) === '1') {
      const data = await listShareRaw(surl, jsToken, cookie, item.path, host)
      files.push(...await collectFiles(surl, jsToken, cookie, Array.isArray(data?.list) ? data.list : [], host))
    } else files.push(item)
  }
  return files
}

async function getSharedDownload(file, info, cookie, host='www.terabox.com', surl='') {
  const { sign, timestamp, shareid, uk, seckey } = info || {}
  if (!sign || !timestamp || !shareid || !uk || !file?.fs_id) return null
  const params = new URLSearchParams({ sign, timestamp, clienttype: '0', web: '1', app_id: '250528', channel: 'dubox' })
  const body = new URLSearchParams({
    encrypt: '0',
    extra: seckey ? JSON.stringify({ seckey }) : '',
    product: 'share',
    timestamp: String(timestamp),
    uk: String(uk),
    primaryid: String(shareid),
    fid_list: JSON.stringify([String(file.fs_id)]),
  })
  const data = await fetchJson(`https://${host}/api/sharedownload?${params}`, {
    method: 'POST',
    headers: { ...buildHeaders(cookie, `https://${host}/sharing/link?surl=${String(surl).replace(/^1/, '')}`), 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (Number(data?.errno) !== 0) return { errno: data?.errno, data }
  const list = Array.isArray(data?.list) ? data.list : []
  const match = list.find(x => String(x?.fs_id) === String(file.fs_id)) || list[0]
  const dlink = String(match?.dlink || '').trim()
  return dlink ? { ...file, ...match, dlink } : { errno: 0, nodlink: true }
}

function isCookieError(errno, msg='') {
  const m = String(msg || '').toLowerCase()
  return [-6,-1,1,2,4,5,112].includes(Number(errno)) || m.includes('cookie') || m.includes('ndus') || m.includes('auth') || m.includes('login')
}

async function resolveViaShareApi(url, cookie) {
  const { candidates, pwd, surl, shareUrl } = parseSurl(url)
  const info = await getSharePageInfo(shareUrl, cookie).catch((e) => ({ _err: String(e?.message||e).slice(0,60) }))
  const errs = []
  if (!info.sign || !info.timestamp) errs.push(`info:sign=${info.sign?'y':'n'} ts=${info.timestamp?'y':'n'} js=${info.jsToken?'y':'n'}${info._err?':'+info._err:''}`)
  for (const cand of candidates) {
    try {
      await verifyShare(cand, pwd, cookie, 'www.terabox.com')
      const data = await listShareRaw(cand, info.jsToken, cookie, null, 'www.terabox.com')
      const errno = Number(data?.errno)
      if (errno !== 0) { errs.push(`list:${cand}:errno=${errno}`); if (isCookieError(errno)) throw new Error(`Terabox cookie/auth failed (errno=${errno}). Update NDUS in Settings.`); continue }
      const files = await collectFiles(cand, info.jsToken, cookie, Array.isArray(data?.list) ? data.list : [], 'www.terabox.com')
      const file = files[0]
      if (!file) { errs.push(`list:${cand}:no-files`); continue }

      if (String(file?.dlink || '').trim()) {
        return mapResult(file, url, 'Resolved via www share/list')
      }

      for (const host of ['www.terabox.com', 'dm.terabox.app', 'dm.terabox.com']) {
        try {
          const dl = await getSharedDownload(file, info, cookie, host, cand)
          if (dl?.dlink) return mapResult(dl, url, `Resolved via ${host}/api/sharedownload`)
          if (dl?.errno && dl.errno !== 0) { errs.push(`sharedownload:${host}:errno=${dl.errno}`); if (isCookieError(dl.errno)) throw new Error(`Terabox cookie/auth failed (errno=${dl.errno}). Update NDUS in Settings.`) }
          else if (dl?.nodlink) errs.push(`sharedownload:${host}:no-dlink`)
        } catch (e) {
          if (isCookieError(0, e?.message)) throw e
          errs.push(`sharedownload:${host}:${String(e?.message || e).slice(0, 60)}`)
        }
      }

      return mapResult(file, url, 'metadata:no-dlink')
    } catch (e) {
      if (isCookieError(0, e?.message)) throw e
      errs.push(`${cand}:${String(e?.message || e).slice(0, 80)}`)
    }
  }
  throw new Error(errs.join('; ') || 'share api failed')
}

async function resolveViaDm(url, cookie) {
  const { candidates, shareUrl } = parseSurl(url)
  const info = await getSharePageInfo(shareUrl, cookie).catch((e) => ({ _err: String(e?.message||e).slice(0,60) }))
  const errs = []
  const hosts = [{ host: 'dm.terabox.app', origin: 'https://www.terabox.app' }, { host: 'dm.terabox.com', origin: 'https://www.terabox.com' }]
  for (const { host, origin } of hosts) {
    for (const shorturl of candidates) {
      try {
        const page = await withTimeout(fetch(`https://${host}/sharing/link?surl=${shorturl.replace(/^1/, '')}`, { headers: buildHeaders(cookie, `${origin}/`) }), 30000, 'Terabox dm page')
        const text = await page.text()
        let jsToken = info.jsToken || ''
        let m = text.match(/fn%28%22(.*?)%22%29/); if (m) jsToken = m[1]
        if (!jsToken) { m = text.match(/fn\("([a-fA-F0-9]+)"\)/); if (m) jsToken = m[1] }
        const params = new URLSearchParams({ app_id: '250528', jsToken, site_referer: `${origin}/`, shorturl: shorturl.replace(/^1/, ''), root: '1' })
        const data = await fetchJson(`https://${host}/share/list?${params}`, {
          headers: { ...buildHeaders(cookie, `https://${host}/sharing/link?surl=${shorturl.replace(/^1/, '')}&clearCache=1`), 'X-Requested-With': 'XMLHttpRequest', 'Origin': origin },
        })
        if (Number(data?.errno) !== 0) { errs.push(`${host}:${shorturl}:errno=${data?.errno}`); if (isCookieError(data?.errno)) throw new Error(`Terabox cookie/auth failed (errno=${data?.errno}). Update NDUS in Settings.`); continue }
        const out = []
        const walk = async (items) => {
          for (const it of items || []) {
            if (String(it.isdir) === '1') {
              const cp = new URLSearchParams({ app_id: '250528', jsToken, site_referer: `${origin}/`, shorturl: shorturl.replace(/^1/, ''), dir: it.path })
              const cd = await fetchJson(`https://${host}/share/list?${cp}`, { headers: { ...buildHeaders(cookie, `https://${host}/sharing/link?surl=${shorturl.replace(/^1/, '')}&clearCache=1`), 'Origin': origin } })
              await walk(Array.isArray(cd?.list) ? cd.list : [])
            } else out.push(it)
          }
        }
        await walk(Array.isArray(data?.list) ? data.list : [])
        const file = out[0]
        if (!file) { errs.push(`${host}:${shorturl}:no-files`); continue }
        if (String(file?.dlink || '').trim()) return mapResult(file, url, `Resolved via ${host}`)
        const dl = await getSharedDownload(file, info, cookie, host, shorturl).catch(() => null)
        if (dl?.dlink) return mapResult(dl, url, `Resolved via ${host}/api/sharedownload`)
        errs.push(`${host}:${shorturl}:no-dlink`)
      } catch (e) {
        if (isCookieError(0, e?.message)) throw e
        errs.push(`${host}:${String(e?.message || e).slice(0, 60)}`)
      }
    }
  }
  throw new Error(errs.join('; ') || 'dm failed')
}

export async function resolveTeraboxDirect(url, { cookie='', ndus='' } = {}) {
  const input = String(url || '').trim()
  if (!isTeraboxUrl(input)) throw new Error('Not a valid Terabox link.')
  const normalizedCookie = normalizeTeraboxCookie(cookie || ndus)
  if (!normalizedCookie) throw new Error('Terabox NDUS/cookie missing. Add it in Settings (device-only).')

  const debug = []
  try {
    const r = await resolveViaShareApi(input, normalizedCookie)
    if (r?.directUrl) return r
    debug.push('share:no-dlink')
  } catch (e) {
    debug.push(`share:${String(e?.message || e).slice(0, 140)}`)
    if (isCookieError(0, e?.message)) throw e
  }

  try {
    const r = await resolveViaDm(input, normalizedCookie)
    if (r?.directUrl) return r
    debug.push('dm:no-dlink')
  } catch (e) {
    debug.push(`dm:${String(e?.message || e).slice(0, 140)}`)
    if (isCookieError(0, e?.message)) throw e
  }

  throw new Error(`Could not resolve direct Terabox link. ${debug.join(' | ').slice(0, 300)}`)
}
