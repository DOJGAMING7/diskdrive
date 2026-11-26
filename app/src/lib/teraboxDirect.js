import { withTimeout } from './async.js'
import { Capacitor, CapacitorHttp } from '@capacitor/core'

const UA = 'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'

function isNetworkError(e) {
  const m = String(e?.message || e || '').toLowerCase()
  return /failed to fetch|network|econn|enotfound|etimedout|timeout|aborted|dns|socket|unreachable/.test(m)
}

async function httpRequest(url, { method='GET', headers={}, body, redirect='follow', timeoutMs=12000, signal } = {}) {
  if (signal?.aborted) throw new Error(signal?.reason?.message || 'Aborted')
  const isNative = !!(Capacitor?.isNativePlatform?.() && CapacitorHttp?.request)
  if (isNative) {
    const opts = { url, method, headers, connectTimeout: Math.max(5, Math.ceil(timeoutMs / 1000)), readTimeout: Math.max(5, Math.ceil(timeoutMs / 1000)) }
    if (body !== undefined) opts.data = body
    const res = await withTimeout(CapacitorHttp.request(opts), timeoutMs, 'Terabox request', { signal })
    const data = res?.data
    const text = typeof data === 'string' ? data : JSON.stringify(data ?? '')
    return { status: res?.status || 0, text, json: () => { try { return typeof data === 'string' ? JSON.parse(data) : data } catch { return null } } }
  }
  const res = await withTimeout(fetch(url, { method, headers, body, redirect, credentials: 'omit', signal }), timeoutMs, 'Terabox request', { signal })
  const text = await res.text()
  return { status: res.status, text, json: () => { try { return JSON.parse(text) } catch { return null } } }
}

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
  let cookie = ''
  if (/ndus=/i.test(raw) || /;/.test(raw) || /=/.test(raw)) cookie = raw
  else cookie = `ndus=${raw}`
  // Terabox web endpoints are happier with lang cookie present
  if (!/(^|;\s*)lang=/i.test(cookie)) cookie = `lang=en; ${cookie}`
  return cookie
}

function shareHostsForUrl(url) {
  let host = 'www.terabox.com'
  try { host = new URL(String(url).trim()).hostname.toLowerCase() } catch {}
  const base = host.replace(/^www\./, '')
  const pref = []
  const push = (h) => { h = String(h||'').trim().toLowerCase(); if (h && !pref.includes(h)) pref.push(h) }
  push(host); push(`www.${base}`); push(base)
  if (base.includes('1024terabox') || base.includes('1024tera')) { push('www.1024tera.com'); push('www.1024terabox.com'); push('1024terabox.com') }
  if (base.includes('teraboxapp')) { push('www.terabox.app'); push('terabox.app') }
  ;['www.terabox.com','www.terabox.app','www.1024tera.com','www.1024terabox.com','terabox.com'].forEach(push)
  return pref.filter(h => /^[a-z0-9.-]+$/.test(h))
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
  const hosts = shareHostsForUrl(url)
  return { surl: clean, candidates, pwd, host: hosts[0] || u.hostname, hosts, shareUrl: `https://${hosts[0] || u.hostname}/sharing/link?surl=${clean}` }
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
  const res = await httpRequest(url, opts)
  const data = res.json()
  if (data && typeof data === 'object') return data
  try { return JSON.parse(res.text) } catch { return { _nonJson: true, _status: res.status, _text: String(res.text||'').slice(0, 160) } }
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

function parseShareInfo(text='') {
  const pick = (re) => { const m = String(text||'').match(re); return m ? m[1] : '' }
  const jsonPick = (key) => pick(new RegExp(`"${key}"\\s*:\\s*"?([\\w\\-+=/]+)"?`))
  return {
    jsToken: pick(/fn\("([a-fA-F0-9]+)"\)/) || jsonPick('jsToken') || pick(/fn%28%22(.*?)%22%29/) || '',
    sign: jsonPick('sign') || pick(/"sign"\s*:\s*"([^"]+)"/),
    timestamp: pick(/"timestamp"\s*:\s*"?(\d+)"?/) || jsonPick('timestamp'),
    shareid: pick(/"shareid"\s*:\s*"?(\d+)"?/) || jsonPick('shareid'),
    uk: pick(/"uk"\s*:\s*"?(\d+)"?/) || jsonPick('uk'),
    seckey: pick(/"seckey"\s*:\s*"([^"]+)"/),
  }
}

async function getSharePageInfo(shareUrl, cookie, hosts=[], { signal } = {}) {
  const surl = (() => { try { return new URL(shareUrl).searchParams.get('surl') || '' } catch { return '' } })()
  const urls = []
  const push = (u) => { if (u && !urls.includes(u)) urls.push(u) }
  push(shareUrl)
  for (const h of hosts || []) push(`https://${h}/sharing/link?surl=${surl}`)
  let out = { jsToken:'', sign:'', timestamp:'', shareid:'', uk:'', seckey:'' }
  let lastErr
  for (const u of urls) {
    try {
      const host = new URL(u).hostname
      const res = await httpRequest(u, { headers: buildHeaders(cookie, `https://${host}/`), redirect: 'follow', timeoutMs: 10000, signal })
      out = { ...out, ...Object.fromEntries(Object.entries(parseShareInfo(res.text)).filter(([,v]) => v)) }
      if (out.sign && out.timestamp && out.shareid && out.uk) return out
    } catch (e) { lastErr = e; if (signal?.aborted) throw e }
  }
  if (lastErr && !out.sign && !out.timestamp) out._err = String(lastErr?.message || lastErr).slice(0,80)
  return out
}

async function verifyShare(surl, pwd, cookie, host='www.terabox.com', { signal } = {}) {
  if (!pwd) return
  const params = new URLSearchParams({ app_id: '250528', surl: `1${String(surl).replace(/^1/, '')}`, pwd })
  await httpRequest(`https://${host}/share/verify?${params}`, { headers: buildHeaders(cookie, `https://${host}/`), timeoutMs: 10000, signal }).catch(() => {})
}

async function listShareRaw(surl, jsToken, cookie, dir=null, host='www.terabox.com', { signal } = {}) {
  const shorturl = String(surl).replace(/^1/, '')
  const params = new URLSearchParams({
    app_id: '250528', web: '1', channel: 'dubox', clienttype: '0',
    jsToken: jsToken || '', shorturl, page: '1', num: '1000', by: 'name', order: 'asc',
    site_referer: `https://${host}/sharing/link?surl=${shorturl}`,
  })
  if (dir) params.set('dir', dir); else params.set('root', '1')
  return fetchJson(`https://${host}/share/list?${params}`, { headers: buildHeaders(cookie, `https://${host}/sharing/link?surl=${shorturl}`), timeoutMs: 12000, signal })
}

async function collectFiles(surl, jsToken, cookie, entries, host='www.terabox.com', { signal } = {}) {
  const files = []
  for (const item of entries || []) {
    if (signal?.aborted) throw new Error('Aborted')
    if (String(item.isdir) === '1') {
      const data = await listShareRaw(surl, jsToken, cookie, item.path, host, { signal })
      files.push(...await collectFiles(surl, jsToken, cookie, Array.isArray(data?.list) ? data.list : [], host, { signal }))
    } else files.push(item)
  }
  return files
}

async function getSharedDownload(file, info, cookie, host='www.terabox.com', surl='', { signal } = {}) {
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
    timeoutMs: 12000,
    signal,
  })
  if (Number(data?.errno) !== 0) return { errno: data?.errno, data }
  const list = Array.isArray(data?.list) ? data.list : []
  const match = list.find(x => String(x?.fs_id) === String(file.fs_id)) || list[0]
  const dlink = String(match?.dlink || '').trim()
  return dlink ? { ...file, ...match, dlink } : { errno: 0, nodlink: true }
}

function isCookieError(errno, msg='') {
  const m = String(msg || '').toLowerCase()
  // errno=2 is often param mismatch; errno=1 can be generic failure - do not hard-fail as cookie.
  return [-6, -1, 4, 5, 112, 910000001].includes(Number(errno)) || m.includes('cookie expired') || m.includes('login required') || m.includes('ndus expired')
}

async function resolveViaShareApi(url, cookie, { signal, info: infoArg } = {}) {
  const { candidates, pwd, shareUrl, hosts } = parseSurl(url)
  const info = infoArg?.sign ? infoArg : await getSharePageInfo(shareUrl, cookie, hosts, { signal }).catch((e) => ({ _err: String(e?.message||e).slice(0,80) }))
  const errs = []
  let netFails = 0
  if (!info.sign || !info.timestamp) errs.push(`info:sign=${info.sign?'y':'n'} ts=${info.timestamp?'y':'n'}${info._err?':'+info._err:''}`)
  const tryHosts = [...hosts, 'dm.terabox.app'].filter((h,i,a)=>h && a.indexOf(h)===i).slice(0, 4)
  for (const cand of candidates.slice(0, 2)) {
    if (signal?.aborted) throw new Error('Aborted')
    for (const host of tryHosts) {
      if (signal?.aborted) throw new Error('Aborted')
      try {
        await verifyShare(cand, pwd, cookie, host, { signal })
        let data = await listShareRaw(cand, info.jsToken, cookie, null, host, { signal })
        let errno = Number(data?.errno)
        if (errno !== 0 && host.includes('terabox.com')) {
          const alt = await fetchJson(`https://${host}/share/list?${new URLSearchParams({ app_id:'250528', web:'1', channel:'dubox', clienttype:'0', jsToken:'', shorturl:String(cand).replace(/^1/,''), root:'1', page:'1', num:'1000', by:'name', order:'asc' })}`, { headers: buildHeaders(cookie, `https://${host}/sharing/link?surl=${String(cand).replace(/^1/, '')}`), timeoutMs: 12000, signal }).catch(()=>null)
          if (alt && Number(alt.errno) === 0) { data = alt; errno = 0 }
        }
        if (errno !== 0) { errs.push(`list:${host}:${cand}:errno=${errno}`); if (isCookieError(errno)) throw new Error(`Terabox cookie/auth failed (errno=${errno}). Update NDUS in Settings.`); continue }
        const files = await collectFiles(cand, info.jsToken, cookie, Array.isArray(data?.list) ? data.list : [], host, { signal })
        const file = files[0]
        if (!file) { errs.push(`list:${host}:${cand}:no-files`); continue }

        if (String(file?.dlink || '').trim()) return mapResult(file, url, `Resolved via ${host}/share/list`)

        for (const dlHost of [...new Set([host, 'dm.terabox.app', 'www.terabox.com'])].slice(0, 3)) {
          try {
            const dl = await getSharedDownload(file, info, cookie, dlHost, cand, { signal })
            if (dl?.dlink) return mapResult(dl, url, `Resolved via ${dlHost}/api/sharedownload`)
            if (dl?.errno && dl.errno !== 0) { errs.push(`sharedownload:${dlHost}:errno=${dl.errno}`); if (isCookieError(dl.errno)) throw new Error(`Terabox cookie/auth failed (errno=${dl.errno}). Update NDUS in Settings.`) }
            else if (dl?.nodlink) errs.push(`sharedownload:${dlHost}:no-dlink`)
          } catch (e) {
            if (isCookieError(0, e?.message)) throw e
            if (isNetworkError(e)) { netFails++; errs.push(`sharedownload:${dlHost}:${String(e?.message || e).slice(0, 60)}`); continue }
            errs.push(`sharedownload:${dlHost}:${String(e?.message || e).slice(0, 60)}`)
          }
        }

        return mapResult(file, url, 'metadata:no-dlink')
      } catch (e) {
        if (isCookieError(0, e?.message)) throw e
        if (isNetworkError(e)) { netFails++; errs.push(`${host}:${String(e?.message || e).slice(0, 80)}`); continue }
        errs.push(`${host}:${cand}:${String(e?.message || e).slice(0, 80)}`)
      }
    }
    if (netFails >= 4) break
  }
  throw new Error(errs.join('; ') || 'share api failed')
}

async function resolveViaDm(url, cookie, info, { signal } = {}) {
  const { candidates, hosts: shareHosts } = parseSurl(url)
  const errs = []
  let netFails = 0
  const hosts = [...new Set(['dm.terabox.app', 'dm.terabox.com', ...shareHosts])].slice(0, 3).map(host => ({ host, origin: `https://${host.replace(/^dm\./, 'www.')}` }))
  for (const { host, origin } of hosts) {
    for (const shorturl of candidates.slice(0, 2)) {
      if (signal?.aborted) throw new Error('Aborted')
      try {
        const page = await httpRequest(`https://${host}/sharing/link?surl=${shorturl.replace(/^1/, '')}`, { headers: buildHeaders(cookie, `${origin}/`), timeoutMs: 10000, signal })
        const text = String(page.text || '')
        let jsToken = info.jsToken || ''
        let m = text.match(/fn%28%22(.*?)%22%29/); if (m) jsToken = m[1]
        if (!jsToken) { m = text.match(/fn\("([a-fA-F0-9]+)"\)/); if (m) jsToken = m[1] }
        const params = new URLSearchParams({ app_id: '250528', jsToken, site_referer: `${origin}/`, shorturl: shorturl.replace(/^1/, ''), root: '1' })
        const data = await fetchJson(`https://${host}/share/list?${params}`, {
          headers: { ...buildHeaders(cookie, `https://${host}/sharing/link?surl=${shorturl.replace(/^1/, '')}&clearCache=1`), 'X-Requested-With': 'XMLHttpRequest', 'Origin': origin },
          timeoutMs: 12000, signal,
        })
        if (Number(data?.errno) !== 0) { errs.push(`${host}:${shorturl}:errno=${data?.errno}`); if (isCookieError(data?.errno)) throw new Error(`Terabox cookie/auth failed (errno=${data?.errno}). Update NDUS in Settings.`); continue }
        const out = []
        const walk = async (items) => {
          for (const it of items || []) {
            if (signal?.aborted) throw new Error('Aborted')
            if (String(it.isdir) === '1') {
              const cp = new URLSearchParams({ app_id: '250528', jsToken, site_referer: `${origin}/`, shorturl: shorturl.replace(/^1/, ''), dir: it.path })
              const cd = await fetchJson(`https://${host}/share/list?${cp}`, { headers: { ...buildHeaders(cookie, `https://${host}/sharing/link?surl=${shorturl.replace(/^1/, '')}&clearCache=1`), 'Origin': origin }, timeoutMs: 12000, signal })
              await walk(Array.isArray(cd?.list) ? cd.list : [])
            } else out.push(it)
          }
        }
        await walk(Array.isArray(data?.list) ? data.list : [])
        const file = out[0]
        if (!file) { errs.push(`${host}:${shorturl}:no-files`); continue }
        if (String(file?.dlink || '').trim()) return mapResult(file, url, `Resolved via ${host}`)
        const dl = await getSharedDownload(file, info, cookie, host, shorturl, { signal }).catch(() => null)
        if (dl?.dlink) return mapResult(dl, url, `Resolved via ${host}/api/sharedownload`)
        errs.push(`${host}:${shorturl}:no-dlink`)
      } catch (e) {
        if (isCookieError(0, e?.message)) throw e
        if (isNetworkError(e)) { netFails++; errs.push(`${host}:${String(e?.message || e).slice(0, 60)}`); if (netFails >= 3) throw new Error(errs.join('; ') || 'Network error'); continue }
        errs.push(`${host}:${String(e?.message || e).slice(0, 60)}`)
      }
    }
  }
  throw new Error(errs.join('; ') || 'dm failed')
}

export async function resolveViaPublicProxy(url, { signal } = {}) {
  const { candidates } = parseSurl(url)
  const errs = []
  for (const s of candidates.slice(0, 1)) {
    try {
      const params = new URLSearchParams({ mode: 'resolve', surl: s.replace(/^1/, ''), raw: '1' })
      const data = await fetchJson(`https://tbx-proxy.shakir-ansarii075.workers.dev/?${params}`, { headers: { 'User-Agent': UA }, timeoutMs: 12000, signal })
      const upstream = data?.upstream || data
      const list = Array.isArray(upstream?.list) ? upstream.list : Array.isArray(upstream?.data?.list) ? upstream.data.list : []
      const flat = []
      const walk = (items) => { for (const it of items || []) { if (String(it?.isdir) === '1') walk(it?.children || it?.list || []) ; else flat.push(it) } }
      walk(list)
      const file = flat[0]
      const dlink = String(file?.dlink || file?.direct_link || file?.directLink || '').trim()
      if (dlink) return mapResult({ ...file, dlink }, url, 'Resolved via public proxy fallback')
      errs.push(`proxy:${s}:no-dlink`)
    } catch (e) { errs.push(`proxy:${String(e?.message||e).slice(0,60)}`) }
  }
  throw new Error(errs.join('; ') || 'proxy failed')
}

export async function resolveTeraboxDirect(url, { cookie='', ndus='', signal, timeoutMs=25000 } = {}) {
  const input = String(url || '').trim()
  if (!isTeraboxUrl(input)) throw new Error('Not a valid Terabox link.')
  const normalizedCookie = normalizeTeraboxCookie(cookie || ndus)
  if (!normalizedCookie) throw new Error('Terabox NDUS/cookie missing. Add it in Settings (device-only).')

  const ctrl = new AbortController()
  const outerAbort = () => ctrl.abort(signal?.reason || new Error('Aborted'))
  if (signal) {
    if (signal.aborted) outerAbort()
    else signal.addEventListener('abort', outerAbort, { once: true })
  }
  const t = setTimeout(() => ctrl.abort(new Error('Resolve timeout')), timeoutMs)
  const s = ctrl.signal

  try {
    const debug = []
    let shareNetFail = false
    const parsed = parseSurl(input)
    const info = await getSharePageInfo(parsed.shareUrl, normalizedCookie, parsed.hosts, { signal: s }).catch(() => ({ jsToken:'', sign:'', timestamp:'', shareid:'', uk:'' }))

    try {
      const r = await resolveViaShareApi(input, normalizedCookie, { signal: s, info })
      if (r?.directUrl) return r
      debug.push('share:no-dlink')
    } catch (e) {
      const msg = String(e?.message || e).slice(0, 160)
      debug.push(`share:${msg}`)
      if (isCookieError(0, e?.message)) throw e
      if (isNetworkError(e)) shareNetFail = true
    }

    if (!s.aborted) {
      try {
        const r = await resolveViaDm(input, normalizedCookie, info, { signal: s })
        if (r?.directUrl) return r
        debug.push('dm:no-dlink')
      } catch (e) {
        debug.push(`dm:${String(e?.message || e).slice(0, 160)}`)
        if (isCookieError(0, e?.message)) throw e
        if (isNetworkError(e)) shareNetFail = true
      }
    }

    if (shareNetFail && debug.every(d => /failed to fetch|network|timeout|aborted|unreachable|dns|econn|enotfound|socket|connect/i.test(d))) {
      throw new Error('Cannot reach Terabox servers on this network. Try another network/DNS/VPN, or switch mobile data. If link opens in browser, the Terabox API host may be blocked on this carrier.')
    }

    if (!s.aborted) {
      try {
        const r = await resolveViaPublicProxy(input, { signal: s })
        if (r?.directUrl) return r
        debug.push('proxy:no-dlink')
      } catch (e) {
        debug.push(`proxy:${String(e?.message || e).slice(0, 120)}`)
      }
    }

    const hasCookieErr = debug.some(d => /errno=(?:-6|-1|4|5|112|910000001)\b/i.test(d))
    if (hasCookieErr) throw new Error(`Terabox cookie/auth failed. Update NDUS in Settings. ${debug.join(' | ').slice(0,260)}`)
    const hasParamErr = debug.some(d => /errno=2\b/i.test(d))
    if (hasParamErr) throw new Error(`Terabox resolve failed (errno=2). Cookie may be invalid, or request params blocked on this device. Re-copy full browser cookie/NDUS and retry. ${debug.join(' | ').slice(0,260)}`)
    if (debug.every(d => /failed to fetch|network|timeout|unreachable|dns/i.test(d))) throw new Error('Cannot reach Terabox servers. Check internet/mobile data, VPN/DNS/private DNS, or adblock, then retry.')
    throw new Error(`Could not resolve direct Terabox link. ${debug.join(' | ').slice(0, 320)}`)
  } finally {
    clearTimeout(t)
    signal?.removeEventListener?.('abort', outerAbort)
  }
}
