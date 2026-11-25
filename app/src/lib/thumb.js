import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { uid } from './id.js'

const THUMB_DIR = 'thumbs'
const isNative = () => Capacitor.isNativePlatform()

async function ensureDir() {
  if (!isNative()) return
  try { await Filesystem.mkdir({ path: THUMB_DIR, directory: Directory.Data, recursive: true }) } catch {}
}

export async function generateThumbnail(src, { timeoutMs = 6000 } = {}) {
  if (!src) return null
  return await new Promise((resolve) => {
    const video = document.createElement('video')
    let done = false
    const cleanup = () => {
      video.removeAttribute('src')
      video.load()
    }
    const finish = (val) => {
      if (done) return
      done = true
      clearTimeout(timer)
      video.onloadedmetadata = null
      video.onseeked = null
      video.onerror = null
      cleanup()
      resolve(val)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    if (/^https?:/i.test(src)) video.crossOrigin = 'anonymous'
    video.src = src

    video.onloadedmetadata = () => {
      try {
        const dur = Number(video.duration || 0)
        const target = dur > 2 ? Math.min(1, dur * 0.1) : Math.min(0.1, Math.max(0, dur / 2))
        video.currentTime = Number.isFinite(target) ? target : 0
      } catch { finish(null) }
    }
    video.onseeked = () => {
      try {
        const w = video.videoWidth || 0
        const h = video.videoHeight || 0
        if (!w || !h) return finish(null)
        const maxW = 320
        const scale = Math.min(1, maxW / w)
        const cw = Math.max(1, Math.round(w * scale))
        const ch = Math.max(1, Math.round(h * scale))
        const canvas = document.createElement('canvas')
        canvas.width = cw
        canvas.height = ch
        const ctx = canvas.getContext('2d')
        if (!ctx) return finish(null)
        ctx.drawImage(video, 0, 0, cw, ch)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
        finish(dataUrl && dataUrl.startsWith('data:image/jpeg') ? dataUrl : null)
      } catch { finish(null) }
    }
    video.onerror = () => finish(null)
  })
}

export async function persistThumbnail(dataUrl, preferredName = uid()) {
  if (!dataUrl) return null
  if (!isNative()) {
    return { thumb: dataUrl, thumbPath: null }
  }
  await ensureDir()
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
  const path = `${THUMB_DIR}/${preferredName}.jpg`
  await Filesystem.writeFile({ path, data: base64, directory: Directory.Data, recursive: true })
  const uri = await Filesystem.getUri({ path, directory: Directory.Data })
  return { thumb: Capacitor.convertFileSrc(uri.uri), thumbPath: path }
}

export async function resolveThumb(item) {
  if (!item) return null
  if (item.thumb && !String(item.thumb).startsWith('blob:')) return item.thumb
  if (isNative() && item.thumbPath) {
    try {
      const uri = await Filesystem.getUri({ path: item.thumbPath, directory: Directory.Data })
      return Capacitor.convertFileSrc(uri.uri)
    } catch {}
  }
  return null
}
