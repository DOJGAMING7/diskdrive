import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { uid } from './id.js'

const JOBS_KEY = 'dd_download_jobs_v2'

function sanitize(name='video.mp4') {
  return String(name || 'video.mp4').replace(/[\\/:*?"<>|]+/g, '').trim() || 'video.mp4'
}

function loadJobs() {
  try { return JSON.parse(localStorage.getItem(JOBS_KEY) || '[]') } catch { return [] }
}
function saveJobsMap(jobs) {
  try {
    const arr = [...jobs.values()].map(j => {
      const { _abort, ...rest } = j
      return { ...rest, speedBps: 0, etaSec: rest.etaSec ?? null }
    })
    localStorage.setItem(JOBS_KEY, JSON.stringify(arr))
  } catch {}
}

async function resolveSaveDir(dirName='Download', storageMode='inapp') {
  const folder = sanitize(dirName) || 'Download'
  if (storageMode === 'device') {
    const candidates = [
      { directory: Directory.ExternalStorage, path: `Download/${folder}` },
      { directory: Directory.Documents, path: `Download/${folder}` },
      { directory: Directory.Documents, path: folder },
    ]
    for (const c of candidates) {
      try { await Filesystem.mkdir({ path: c.path, directory: c.directory, recursive: true }); return { ...c, stored: 'native-external' } } catch {}
    }
    return { directory: Directory.Documents, path: folder, stored: 'native-external' }
  }
  const path = `downloads/${folder}`
  try { await Filesystem.mkdir({ path, directory: Directory.Data, recursive: true }) } catch {}
  return { directory: Directory.Data, path, stored: 'app-private' }
}

function keyFor(item) { return item?.sourceUrl || item?.directUrl || item?.src || item?.id || '' }
function isActive(j) { return j && ['queued','downloading','resolving'].includes(j.status) }

function normalizeUrlList(job) {
  return [job.proxyDownloadUrl, job.downloadUrl, job.proxyStreamUrl, job.directUrl, job.src]
    .filter(u => typeof u === 'string' && /^https?:|^blob:|^data:/i.test(u))
}

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error('read failed'))
    r.onload = () => { const s = String(r.result || ''); resolve(s.includes(',') ? s.split(',')[1] : s) }
    r.readAsDataURL(blob)
  })
}

function triggerBlobDownload(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

export function createDownloadManager({ onUpdate, onComplete, resolveItem }) {
  const jobs = new Map()
  const controllers = new Map()
  let running = 0
  const max = 2

  function emit() { saveJobsMap(jobs); onUpdate?.([...jobs.values()].map(j => ({ ...j }))) }

  for (const j of loadJobs()) {
    if (!j?.id) continue
    if (isActive(j)) { j.status = 'error'; j.error = j.error || 'Interrupted - tap Retry'; j.speedBps = 0; j.etaSec = null }
    jobs.set(j.id, j)
  }
  emit()

  function markCancelled(job) {
    job.status = 'cancelled'
    job.error = ''
    job.speedBps = 0
    job.etaSec = null
  }

  async function run(job) {
    job.status = 'downloading'
    job.error = ''
    job.startedAt = Date.now()
    job.receivedBytes = job.receivedBytes || 0
    job.totalBytes = job.totalBytes || Number(job.size || 0) || 0
    job.speedBps = 0
    job.etaSec = null
    emit()
    const ctrl = new AbortController()
    controllers.set(job.id, ctrl)
    try {
      const name = sanitize(job.fileName || job.name || 'video.mp4')
      let candidates = normalizeUrlList(job)
      if (!candidates.length) throw new Error('No download URL')

      if (Capacitor.isNativePlatform()) {
        const destDir = await resolveSaveDir(job.dirName || 'Download', job.storageMode || 'inapp')
        const dest = `${destDir.path}/${name}`
        const tryNative = async (dlUrl) => {
          let lastPct = -1
          let listener
          try {
            listener = await Filesystem.addListener('progress', (p) => {
              if (p?.url !== dlUrl) return
              const total = Number(p.contentLength || job.totalBytes || 0)
              const bytes = Number(p.bytes || 0)
              if (total) job.totalBytes = total
              job.receivedBytes = bytes
              const elapsed = Math.max(0.001, (Date.now() - (job.startedAt || Date.now())) / 1000)
              job.speedBps = bytes / elapsed
              job.etaSec = total && job.speedBps > 0 ? Math.max(0, Math.round((total - bytes) / job.speedBps)) : null
              const pct = total ? Math.min(99, Math.round((bytes / total) * 100)) : job.progress
              if (pct !== lastPct) { lastPct = pct; job.progress = pct }
              emit()
            })
          } catch {}
          try {
            const res = await Filesystem.downloadFile({ url: dlUrl, path: dest, directory: destDir.directory, progress: true })
            if (job.status === 'cancelled') throw new DOMException('Aborted', 'AbortError')
            if (!res?.path && !res) throw new Error('Download failed')
            try {
              const st = await Filesystem.stat({ path: dest, directory: destDir.directory })
              if (st?.size) { job.size = Number(st.size); job.totalBytes = Number(st.size); job.receivedBytes = Number(st.size) }
              if (!st?.size && !job.totalBytes) throw new Error('Downloaded file is empty')
            } catch (e) { if (/empty/i.test(String(e?.message||''))) throw e }
            return true
          } finally {
            try { await listener?.remove() } catch {}
          }
        }

        {

        let ok = false
        let lastErr
        for (const c of candidates) {
          if (job.status === 'cancelled') throw new DOMException('Aborted', 'AbortError')
          try { ok = await tryNative(c); if (ok) { job.finalUrl = c; break } } catch (e) { lastErr = e }
        }
        if (!ok && resolveItem && job.sourceUrl) {
          job.status = 'resolving'; job.error = ''; emit()
          try {
            const fresh = await resolveItem(job)
            Object.assign(job, {
              downloadUrl: fresh.downloadUrl || job.downloadUrl,
              directUrl: fresh.directUrl || job.directUrl,
              proxyDownloadUrl: fresh.proxyDownloadUrl || job.proxyDownloadUrl,
              proxyStreamUrl: fresh.proxyStreamUrl || job.proxyStreamUrl,
              src: fresh.src || job.src,
              thumb: fresh.thumb || job.thumb,
              size: fresh.size || job.size,
              sizeHuman: fresh.sizeHuman || job.sizeHuman,
            })
            candidates = normalizeUrlList(job)
            job.status = 'downloading'; emit()
            for (const c of candidates) {
              if (job.status === 'cancelled') throw new DOMException('Aborted', 'AbortError')
              try { ok = await tryNative(c); if (ok) { job.finalUrl = c; break } } catch (e) { lastErr = e }
            }
          } catch (e) { lastErr = e }
        }
        if (job.status === 'cancelled') throw new DOMException('Aborted', 'AbortError')
        if (!ok) throw lastErr || new Error('Download failed')

        job.progress = 100
        job.status = 'done'
        job.savedPath = dest
        job.savedDirectory = String(destDir.directory)
        job.nativePath = dest
        job.kind = 'local'
        job.stored = destDir.stored || (job.storageMode === 'device' ? 'native-external' : 'app-private')
        job.completedAt = Date.now()
        job.speedBps = 0
        job.etaSec = 0
        try {
          const uri = await Filesystem.getUri({ path: dest, directory: destDir.directory })
          job.nativeUri = uri?.uri || ''
          job.srcLocal = job.nativeUri ? Capacitor.convertFileSrc(job.nativeUri) : (job.srcLocal || job.src)
        } catch { job.srcLocal = job.srcLocal || job.src }
        }
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
              if (ctrl.signal.aborted) throw new DOMException('Aborted', 'AbortError')
              const { done, value } = await reader.read()
              if (done) break
              chunks.push(value)
              received += value.length
              job.receivedBytes = received
              job.totalBytes = total
              const nowT = Date.now()
              const dt = (nowT - lastT) / 1000
              if (dt >= 0.5) { job.speedBps = (received - lastB) / dt; lastT = nowT; lastB = received }
              job.etaSec = job.speedBps > 0 ? Math.max(0, Math.round((total - received) / job.speedBps)) : null
              job.progress = Math.min(99, Math.round((received / total) * 100))
              emit()
            }
            const blob = new Blob(chunks, { type: res.headers.get('content-type') || 'video/mp4' })
            job.size = blob.size; job.totalBytes = blob.size; job.receivedBytes = blob.size
            return blob
          }
          const b = await res.blob()
          job.size = b.size; job.totalBytes = b.size; job.receivedBytes = b.size
          return b
        }

        let blob
        let lastErr
        for (const c of candidates) {
          if (job.status === 'cancelled') throw new DOMException('Aborted', 'AbortError')
          try { blob = await doWeb(c); job.finalUrl = c; break } catch (e) { lastErr = e }
        }
        if (!blob && resolveItem && job.sourceUrl) {
          try {
            job.status = 'resolving'; emit()
            const fresh = await resolveItem(job)
            Object.assign(job, {
              downloadUrl: fresh.downloadUrl || job.downloadUrl,
              directUrl: fresh.directUrl || job.directUrl,
              proxyDownloadUrl: fresh.proxyDownloadUrl || job.proxyDownloadUrl,
              proxyStreamUrl: fresh.proxyStreamUrl || job.proxyStreamUrl,
              src: fresh.src || job.src,
            })
            candidates = normalizeUrlList(job)
            job.status = 'downloading'; emit()
            for (const c of candidates) {
              if (job.status === 'cancelled') throw new DOMException('Aborted', 'AbortError')
              try { blob = await doWeb(c); job.finalUrl = c; break } catch (e) { lastErr = e }
            }
          } catch (e) { lastErr = e }
        }
        if (!blob) throw lastErr || new Error('Download failed')
        triggerBlobDownload(blob, name)
        job.progress = 100
        job.status = 'done'
        job.savedPath = name
        job.stored = 'web-download'
        job.kind = 'local'
        job.completedAt = Date.now()
        job.speedBps = 0
        job.etaSec = 0
      }
    } catch (e) {
      if (e?.name === 'AbortError' || job.status === 'cancelled') {
        markCancelled(job)
      } else {
        const msg = String(e?.message || e || 'Download failed')
        job.status = 'error'
        job.speedBps = 0
        job.etaSec = null
        job.error = /Failed to fetch/i.test(msg)
          ? 'Failed to fetch (network/CORS/cold start). Tap Retry; if it persists, check resolver/connection in Settings.'
          : msg.slice(0, 220)
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
      run(job).finally(() => { running = Math.max(0, running - 1); pump() })
    }
  }

  return {
    enqueue(item, dirName='Download', storageMode='inapp') {
      const k = keyFor(item)
      const existingActive = [...jobs.values()].find(j => isActive(j) && keyFor(j) === k)
      if (existingActive) return { id: existingActive.id, deduped: true, status: existingActive.status }
      const reuse = item?.id && jobs.get(item.id) ? jobs.get(item.id) : [...jobs.values()].find(j => !isActive(j) && keyFor(j) === k)
      const base = {
        title: item.title || item.name || reuse?.title,
        name: item.name || reuse?.name,
        fileName: item.fileName || item.name || reuse?.fileName || 'video.mp4',
        itemId: item.itemId || item.id || reuse?.itemId,
        src: item.src || reuse?.src,
        directUrl: item.directUrl || reuse?.directUrl,
        downloadUrl: item.downloadUrl || reuse?.downloadUrl,
        proxyDownloadUrl: item.proxyDownloadUrl || reuse?.proxyDownloadUrl,
        proxyStreamUrl: item.proxyStreamUrl || reuse?.proxyStreamUrl,
        sourceUrl: item.sourceUrl || reuse?.sourceUrl,
        provider: item.provider || reuse?.provider,
        kind: item.kind || reuse?.kind,
        thumb: item.thumb || reuse?.thumb,
        thumbPath: item.thumbPath || reuse?.thumbPath,
        date: item.date || reuse?.date,
        size: Number(item.size || reuse?.size || 0) || 0,
        sizeHuman: item.sizeHuman || reuse?.sizeHuman,
        dirName,
        storageMode,
      }
      if (reuse) {
        Object.assign(reuse, base, { progress: 0, status: 'queued', error: '', startedAt: null, receivedBytes: 0, speedBps: 0, etaSec: null, completedAt: null })
        emit(); pump()
        return { id: reuse.id, deduped: false, status: reuse.status, reused: true }
      }
      const id = uid()
      const job = { id, ...base, progress: 0, status: 'queued', error: '', createdAt: Date.now(), receivedBytes: 0, totalBytes: Number(base.size || 0) || 0, speedBps: 0, etaSec: null }
      jobs.set(id, job)
      emit(); pump()
      return { id, deduped: false, status: job.status }
    },
    cancel(id) {
      const job = jobs.get(id)
      if (!job) return
      if (job.status === 'queued') { markCancelled(job); emit(); return }
      if (isActive(job)) { markCancelled(job); try { controllers.get(id)?.abort() } catch {}; emit(); return }
    },
    remove(id) {
      const job = jobs.get(id)
      if (!job) return
      if (isActive(job)) this.cancel(id)
      jobs.delete(id)
      controllers.delete(id)
      emit()
    },
    clearDone() {
      for (const [id, j] of jobs) if (['done', 'error', 'cancelled'].includes(j.status)) jobs.delete(id)
      emit()
    },
    getAll() { return [...jobs.values()] },
    getActiveForItem(item) {
      const k = keyFor(item)
      return [...jobs.values()].find(j => isActive(j) && keyFor(j) === k) || null
    },
  }
}
