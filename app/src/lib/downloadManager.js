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

export function createDownloadManager({ onUpdate, onComplete }) {
  const jobs = new Map()
  let running = 0
  const max = 2

  function emit() { onUpdate?.([...jobs.values()].map(j => ({ ...j }))) }

  async function run(job) {
    job.status = 'downloading'; job.error = ''; emit()
    try {
      const name = sanitize(job.fileName || job.name || 'video.mp4')
      const url = job.downloadUrl || job.directUrl || job.src
      if (!url) throw new Error('No download URL')

      if (Capacitor.isNativePlatform()) {
        const destDir = await resolveSaveDir(job.dirName || 'Download')
        const dest = `${destDir.path}/${name}`
        // Capacitor downloadFile has progress in newer versions; fallback to no-progress
        try {
          let lastPct = 0
          const listener = await Filesystem.addListener('progress', (p) => {
            if (p?.url !== url) return
            const pct = p.contentLength ? Math.round((p.bytes / p.contentLength) * 100) : job.progress
            if (pct !== lastPct) { lastPct = pct; job.progress = pct; emit() }
          })
          const res = await Filesystem.downloadFile({ url, path: dest, directory: destDir.directory, progress: true })
          try { await listener.remove() } catch {}
          if (!res?.path && !res) throw new Error('Download failed')
          job.progress = 100; job.status = 'done'; job.savedPath = dest; job.savedDirectory = String(destDir.directory)
        } catch (e) {
          // fallback: fetch blob then write base64
          job.progress = 0; emit()
          const res = await fetch(url)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const blob = await res.blob()
          const b64 = await blobToBase64(blob)
          await Filesystem.writeFile({ path: dest, data: b64, directory: destDir.directory, recursive: true })
          job.progress = 100; job.status = 'done'; job.savedPath = dest; job.savedDirectory = String(destDir.directory)
        }
      } else {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const total = Number(res.headers.get('content-length') || 0)
        if (res.body && total) {
          const reader = res.body.getReader()
          const chunks = []
          let received = 0
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            chunks.push(value)
            received += value.length
            job.progress = Math.min(99, Math.round((received / total) * 100))
            emit()
          }
          const blob = new Blob(chunks, { type: res.headers.get('content-type') || 'video/mp4' })
          triggerBlobDownload(blob, name)
        } else {
          const blob = await res.blob()
          triggerBlobDownload(blob, name)
        }
        job.progress = 100; job.status = 'done'; job.savedPath = name
      }
    } catch (e) {
      job.status = 'error'; job.error = String(e?.message || e).slice(0, 200)
    }
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

  return {
    enqueue(item, dirName='Download') {
      const id = uid()
      const job = {
        id, itemId: item.id, title: item.title || item.name, name: item.name, fileName: item.fileName || item.name || 'video.mp4',
        src: item.src, directUrl: item.directUrl, downloadUrl: item.downloadUrl, sourceUrl: item.sourceUrl,
        provider: item.provider, kind: item.kind, thumb: item.thumb, thumbPath: item.thumbPath, date: item.date, size: item.size, sizeHuman: item.sizeHuman,
        dirName, progress: 0, status: 'queued', error: '', createdAt: Date.now(),
      }
      jobs.set(id, job)
      emit(); pump()
      return id
    },
    getAll() { return [...jobs.values()] },
    clearDone() { for (const [id,j] of jobs) if (j.status==='done'||j.status==='error') jobs.delete(id); emit() },
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
