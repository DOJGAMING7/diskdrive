import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { uid } from './id.js'

function sanitize(name='video.mp4') {
  return String(name).replace(/[\\/:*?"<>|]+/g, '').trim() || 'video.mp4'
}

async function resolveSaveDir(dirName='Download') {
  const folder = sanitize(dirName) || 'Download'
  const candidates = [
    { directory: Directory.ExternalStorage, path: `Download/${folder}` },
    { directory: Directory.Documents, path: folder },
  ]
  for (const c of candidates) {
    try { await Filesystem.mkdir({ path: c.path, directory: c.directory, recursive: true }); return c } catch {}
  }
  return { directory: Directory.Documents, path: folder }
}

export function createDownloadManager({ onUpdate, onComplete, resolveItem }) {
  const jobs = new Map()
  const controllers = new Map()
  let running = 0
  const max = 2

  function emit() { onUpdate?.([...jobs.values()].map(j => ({ ...j }))) }
  function isActive(j) { return j && ['queued','downloading','resolving'].includes(j.status) }

  async function run(job) {
    job.status = 'downloading'; job.error = ''; job.startedAt = Date.now(); job.receivedBytes = 0; job.totalBytes = job.size || 0; job.speedBps = 0; job.etaSec = null;
    emit()
    const ctrl = new AbortController()
    controllers.set(job.id, ctrl)
    try {
      const name = sanitize(job.fileName || job.name || 'video.mp4')
      const candidates = [job.proxyDownloadUrl, job.downloadUrl, job.proxyStreamUrl, job.directUrl, job.src].filter(Boolean)
      let url = candidates[0]
      if (!url) throw new Error('No download URL')

      if (Capacitor.isNativePlatform()) {
        const destDir = await resolveSaveDir(job.dirName || 'Download')
        const dest = `${destDir.path}/${name}`
        // Capacitor downloadFile has progress in newer versions; fallback to no-progress
        const tryNative = async (dlUrl) => {
          let lastPct = 0
          let listener
          try { listener = await Filesystem.addListener('progress', (p) => {
            if (p?.url !== dlUrl) return
            const total = Number(p.contentLength || job.totalBytes || 0)
            const bytes = Number(p.bytes || 0)
            if (total) job.totalBytes = total
            job.receivedBytes = bytes
            const elapsed = (Date.now() - (job.startedAt||Date.now())) / 1000
            job.speedBps = elapsed > 0 ? bytes / elapsed : 0
            job.etaSec = (total && job.speedBps > 0) ? Math.max(0, Math.round((total - bytes) / job.speedBps)) : null
            const pct = total ? Math.round((bytes / total) * 100) : job.progress
            if (pct !== lastPct) { lastPct = pct; job.progress = pct; emit() } else { emit() }
          }) } catch {}
          try {
            const res = await Filesystem.downloadFile({ url: dlUrl, path: dest, directory: destDir.directory, progress: true })
            if (!res?.path && !res) throw new Error('Download failed')
            return true
          } finally { try { await listener?.remove() } catch {} }
        }
        let ok = false
        let lastErr
        for (const c of candidates) {
          try { ok = await tryNative(c); if (ok) { url = c; break } } catch (e) { lastErr = e }
          if (job.status === 'cancelled') throw new DOMException('Aborted','AbortError')
        }
        if (!ok && resolveItem && job.sourceUrl) {
          job.status = 'resolving'; job.error = ''; emit()
          try {
            const fresh = await resolveItem(job)
            const next = [fresh.proxyDownloadUrl, fresh.downloadUrl, fresh.proxyStreamUrl, fresh.directUrl, fresh.src].filter(Boolean)
            job.downloadUrl = fresh.downloadUrl || job.downloadUrl; job.directUrl = fresh.directUrl || job.directUrl; job.proxyDownloadUrl = fresh.proxyDownloadUrl || job.proxyDownloadUrl; job.src = fresh.src || job.src
            job.status = 'downloading'; emit()
            for (const c of next) { try { ok = await tryNative(c); if (ok) { url=c; break } } catch (e) { lastErr = e } }
          } catch (e) { lastErr = e }
        }
        if (job.status === 'cancelled') throw new DOMException('Aborted','AbortError')
        if (!ok) throw lastErr || new Error('Download failed')
        if (job.status === 'cancelled') throw new DOMException('Aborted','AbortError')
        job.progress = 100; job.status = 'done'; job.savedPath = dest; job.savedDirectory = String(destDir.directory)
        job.nativePath = dest; job.kind = 'local'; job.stored = 'native-external'
        try {
          const uri = await Filesystem.getUri({ path: dest, directory: destDir.directory })
          job.nativeUri = uri?.uri || ''
          job.srcLocal = job.nativeUri ? Capacitor.convertFileSrc(job.nativeUri) : job.src
        } catch { job.srcLocal = job.src }
        try { const st = await Filesystem.stat({ path: dest, directory: destDir.directory }); if (st?.size) job.size = Number(st.size) } catch {}
      } else {
        const doWeb = async (dlUrl) => {
          const res = await fetch(dlUrl, { signal: ctrl.signal })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const total = Number(res.headers.get('content-length') || 0)
          if (res.body && total) {
            const reader = res.body.getReader()
            const chunks = []
            let received = 0
            let lastT = Date.now(), lastB = 0
            while (true) {
              if (ctrl.signal.aborted) throw new DOMException('Aborted','AbortError')
              const { done, value } = await reader.read()
              if (done) break
              chunks.push(value)
              received += value.length
              job.receivedBytes = received; job.totalBytes = total
              const nowT = Date.now(); const dt = (nowT - lastT) / 1000
              if (dt >= 0.5) { job.speedBps = (received - lastB) / dt; lastT = nowT; lastB = received }
              job.etaSec = job.speedBps > 0 ? Math.max(0, Math.round((total - received) / job.speedBps)) : null
              job.progress = Math.min(99, Math.round((received / total) * 100))
              emit()
            }
            return new Blob(chunks, { type: res.headers.get('content-type') || 'video/mp4' })
          }
          const b = await res.blob(); job.totalBytes = b.size; job.receivedBytes = b.size; return b
        }
        let blob
        let lastErr
        for (const c of candidates) {
          try { blob = await doWeb(c); url = c; break } catch (e) { lastErr = e }
        }
        if (!blob && resolveItem && job.sourceUrl) {
          try {
            job.status = 'resolving'; emit()
            const fresh = await resolveItem(job)
            const next = [fresh.proxyDownloadUrl, fresh.downloadUrl, fresh.proxyStreamUrl, fresh.directUrl, fresh.src].filter(Boolean)
            job.downloadUrl = fresh.downloadUrl || job.downloadUrl; job.directUrl = fresh.directUrl || job.directUrl; job.proxyDownloadUrl = fresh.proxyDownloadUrl || job.proxyDownloadUrl; job.src = fresh.src || job.src
            job.status = 'downloading'; emit()
            for (const c of next) { try { blob = await doWeb(c); url = c; break } catch (e) { lastErr = e } }
          } catch (e) { lastErr = e }
        }
        if (!blob) throw lastErr || new Error('Download failed')
        const blobUrl = URL.createObjectURL(blob)
        triggerBlobDownloadBlobUrl(blobUrl, name)
        job.progress = 100; job.status = 'done'; job.savedPath = name; job.srcLocal = blobUrl; job.stored = 'web-download'; job.kind = 'local' 
      }
    } catch (e) {
      if (e?.name === 'AbortError' || job.status === 'cancelled') {
        job.status = 'cancelled'; job.error = ''
      } else {
        const msg = String(e?.message || e || 'Download failed')
        job.status = 'error'; job.error = msg.includes('Failed to fetch') ? 'Failed to fetch (network/CORS). Try Check update, Restart app, or use resolver proxy.' : msg.slice(0, 200)
      }
    }
    controllers.delete(job.id)
    emit()
    onComplete?.({ ...job })
  }

  function pump() {
    for (const job of jobs.values()) {
      if (running >= max) break
      if (job.status !== 'queued') continue
      running++
      run(job).finally(() => { running--; pump() })
    }
  }

  function keyFor(item) { return item?.sourceUrl || item?.directUrl || item?.src || item?.id || '' }
  return {
    enqueue(item, dirName='Download') {
      const k = keyFor(item)
      const existingActive = [...jobs.values()].find(j => isActive(j) && keyFor(j) === k)
      if (existingActive) return { id: existingActive.id, deduped: true, status: existingActive.status }
      // reuse failed/cancelled/done job entry for same key to avoid duplicate queue windows
      const reuse = item?.id && jobs.get(item.id) ? jobs.get(item.id) : [...jobs.values()].find(j => !isActive(j) && keyFor(j) === k)
      if (reuse) {
        Object.assign(reuse, {
          ...reuse,
          title: item.title || item.name || reuse.title, name: item.name || reuse.name, fileName: item.fileName || item.name || reuse.fileName,
          src: item.src || reuse.src, directUrl: item.directUrl || reuse.directUrl, downloadUrl: item.downloadUrl || reuse.downloadUrl,
          proxyDownloadUrl: item.proxyDownloadUrl || reuse.proxyDownloadUrl, proxyStreamUrl: item.proxyStreamUrl || reuse.proxyStreamUrl, sourceUrl: item.sourceUrl || reuse.sourceUrl,
          dirName, progress: 0, status: 'queued', error: '', startedAt: null, receivedBytes: 0, speedBps: 0, etaSec: null, savedPath: null, nativePath: null, nativeUri: null, srcLocal: null,
        })
        emit(); pump()
        return { id: reuse.id, deduped: false, status: reuse.status, reused: true }
      }
      const id = uid()
      const job = {
        id, itemId: item.id, title: item.title || item.name, name: item.name, fileName: item.fileName || item.name || 'video.mp4',
        src: item.src, directUrl: item.directUrl, downloadUrl: item.downloadUrl, proxyDownloadUrl: item.proxyDownloadUrl, proxyStreamUrl: item.proxyStreamUrl, sourceUrl: item.sourceUrl,
        provider: item.provider, kind: item.kind, thumb: item.thumb, thumbPath: item.thumbPath, date: item.date, size: item.size, sizeHuman: item.sizeHuman,
        dirName, progress: 0, status: 'queued', error: '', createdAt: Date.now(),
        receivedBytes: 0, totalBytes: Number(item.size||0)||0, speedBps: 0, etaSec: null,
      }
      jobs.set(id, job)
      emit(); pump()
      return { id, deduped: false, status: job.status }
    },
    cancel(id) {
      const job = jobs.get(id)
      if (!job) return
      if (job.status === 'queued') { job.status = 'cancelled'; job.error=''; emit(); return }
      if (['downloading','resolving'].includes(job.status)) { job.status = 'cancelled'; job.error=''; try { controllers.get(id)?.abort() } catch {} emit(); return }
    },
    getAll() { return [...jobs.values()] },
    getActiveForItem(item) {
      const k = keyFor(item)
      return [...jobs.values()].find(j => isActive(j) && keyFor(j) === k) || null
    },
    remove(id) {
      const job = jobs.get(id)
      if (!job) return
      if (isActive(job)) { this.cancel(id) }
      jobs.delete(id); controllers.delete(id); emit()
    },
    clearDone() { for (const [id,j] of jobs) if (['done','error','cancelled'].includes(j.status)) jobs.delete(id); emit() },
  }
}

function triggerBlobDownload(blob, name) {
  const url = URL.createObjectURL(blob)
  triggerBlobDownloadBlobUrl(url, name)
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
function triggerBlobDownloadBlobUrl(url, name) {
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error('read failed'))
    r.onload = () => { const s = String(r.result || ''); resolve(s.includes(',') ? s.split(',')[1] : s) }
    r.readAsDataURL(blob)
  })
}
