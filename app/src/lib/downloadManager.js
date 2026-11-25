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
    job.status = 'downloading'; job.error = ''; emit()
    const ctrl = new AbortController()
    controllers.set(job.id, ctrl)
    try {
      const name = sanitize(job.fileName || job.name || 'video.mp4')
      let url = job.proxyDownloadUrl || job.downloadUrl || job.proxyStreamUrl || job.directUrl || job.src
      if (!url) throw new Error('No download URL')

      if (Capacitor.isNativePlatform()) {
        const destDir = await resolveSaveDir(job.dirName || 'Download')
        const dest = `${destDir.path}/${name}`
        // Capacitor downloadFile has progress in newer versions; fallback to no-progress
        const tryNative = async (dlUrl) => {
          let lastPct = 0
          let listener
          try { listener = await Filesystem.addListener('progress', (p) => { if (p?.url !== dlUrl) return; const pct = p.contentLength ? Math.round((p.bytes / p.contentLength) * 100) : job.progress; if (pct !== lastPct) { lastPct = pct; job.progress = pct; emit() } }) } catch {}
          try {
            const res = await Filesystem.downloadFile({ url: dlUrl, path: dest, directory: destDir.directory, progress: true })
            if (!res?.path && !res) throw new Error('Download failed')
            return true
          } finally { try { await listener?.remove() } catch {} }
        }
        let ok = false
        try { ok = await tryNative(url) } catch (e) {
          // if expired/forbidden and we can re-resolve, retry once
          if (resolveItem && job.sourceUrl) {
            job.status = 'resolving'; job.error = ''; emit()
            const fresh = await resolveItem(job)
            url = fresh.proxyDownloadUrl || fresh.downloadUrl || fresh.proxyStreamUrl || fresh.directUrl || fresh.src || url
            job.downloadUrl = fresh.downloadUrl || job.downloadUrl
            job.directUrl = fresh.directUrl || job.directUrl
            job.proxyDownloadUrl = fresh.proxyDownloadUrl || job.proxyDownloadUrl
            job.src = fresh.src || job.src
            job.status = 'downloading'; emit()
            ok = await tryNative(url)
          } else { throw e }
        }
        if (job.status === 'cancelled') throw new DOMException('Aborted','AbortError')
        if (!ok) throw new Error('Download failed')
        job.progress = 100; job.status = 'done'; job.savedPath = dest; job.savedDirectory = String(destDir.directory)
      } else {
        const doWeb = async (dlUrl) => {
          const res = await fetch(dlUrl, { signal: ctrl.signal })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const total = Number(res.headers.get('content-length') || 0)
          if (res.body && total) {
            const reader = res.body.getReader()
            const chunks = []
            let received = 0
            while (true) {
              if (ctrl.signal.aborted) throw new DOMException('Aborted','AbortError')
              const { done, value } = await reader.read()
              if (done) break
              chunks.push(value)
              received += value.length
              job.progress = Math.min(99, Math.round((received / total) * 100))
              emit()
            }
            return new Blob(chunks, { type: res.headers.get('content-type') || 'video/mp4' })
          }
          return await res.blob()
        }
        let blob
        try { blob = await doWeb(url) } catch (e) {
          if (resolveItem && job.sourceUrl) {
            job.status = 'resolving'; emit()
            const fresh = await resolveItem(job)
            url = fresh.proxyDownloadUrl || fresh.downloadUrl || fresh.proxyStreamUrl || fresh.directUrl || fresh.src || url
            job.downloadUrl = fresh.downloadUrl || job.downloadUrl; job.directUrl = fresh.directUrl || job.directUrl; job.proxyDownloadUrl = fresh.proxyDownloadUrl || job.proxyDownloadUrl; job.src = fresh.src || job.src
            job.status = 'downloading'; emit()
            blob = await doWeb(url)
          } else throw e
        }
        triggerBlobDownload(blob, name)
        job.progress = 100; job.status = 'done'; job.savedPath = name
      }
    } catch (e) {
      if (e?.name === 'AbortError' || job.status === 'cancelled') {
        job.status = 'cancelled'; job.error = ''
      } else {
        job.status = 'error'; job.error = String(e?.message || e).slice(0, 200)
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
      const existing = [...jobs.values()].find(j => isActive(j) && keyFor(j) === k)
      if (existing) return { id: existing.id, deduped: true, status: existing.status }
      const id = uid()
      const job = {
        id, itemId: item.id, title: item.title || item.name, name: item.name, fileName: item.fileName || item.name || 'video.mp4',
        src: item.src, directUrl: item.directUrl, downloadUrl: item.downloadUrl, proxyDownloadUrl: item.proxyDownloadUrl, proxyStreamUrl: item.proxyStreamUrl, sourceUrl: item.sourceUrl,
        provider: item.provider, kind: item.kind, thumb: item.thumb, thumbPath: item.thumbPath, date: item.date, size: item.size, sizeHuman: item.sizeHuman,
        dirName, progress: 0, status: 'queued', error: '', createdAt: Date.now(),
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
    clearDone() { for (const [id,j] of jobs) if (['done','error','cancelled'].includes(j.status)) jobs.delete(id); emit() },
  }
}

function triggerBlobDownload(blob, name) {
  const a = document.createElement('a')
  const url = URL.createObjectURL(blob)
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error('read failed'))
    r.onload = () => { const s = String(r.result || ''); resolve(s.includes(',') ? s.split(',')[1] : s) }
    r.readAsDataURL(blob)
  })
}
