import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { uid } from './id.js'
import { generateThumbnail, persistThumbnail } from './thumb.js'

export const isNative = () => Capacitor.isNativePlatform()
const MEDIA_DIR = 'media'

async function ensureDir() {
  if (!isNative()) return
  try { await Filesystem.mkdir({ path: MEDIA_DIR, directory: Directory.Data, recursive: true }) } catch {}
}

async function makeThumb(src, id) {
  try {
    const dataUrl = await generateThumbnail(src)
    if (!dataUrl) return {}
    return await persistThumbnail(dataUrl, id)
  } catch { return {} }
}

export async function importLocalFile(file) {
  const id = uid()
  if (!isNative()) {
    const src = URL.createObjectURL(file)
    const thumbData = await makeThumb(src, id)
    return { id, provider:'LOCAL', kind:'local', title:file.name.replace(/\.[^.]+$/,''), name:file.name, src, thumb: thumbData.thumb || '', thumbPath: thumbData.thumbPath || null, fileName:file.name, size:file.size||0, type:file.type||'video/*', stored:'web-object-url', addedAt: Date.now() }
  }
  await ensureDir()
  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase()
  const path = `${MEDIA_DIR}/${id}.${ext}`
  const data = await fileToBase64(file)
  await Filesystem.writeFile({ path, data, directory: Directory.Data })
  const uri = await Filesystem.getUri({ path, directory: Directory.Data })
  const src = Capacitor.convertFileSrc(uri.uri)
  const thumbData = await makeThumb(src, id)
  return { id, provider:'LOCAL', kind:'native-file', title:file.name.replace(/\.[^.]+$/,''), name:file.name, src, thumb: thumbData.thumb || '', thumbPath: thumbData.thumbPath || null, nativePath:path, fileName:file.name, size:file.size||0, type:file.type||'video/*', stored:'app-private', addedAt: Date.now() }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read failed'))
    reader.onload = () => {
      const res = String(reader.result || '')
      resolve(res.includes(',') ? res.split(',')[1] : res)
    }
    reader.readAsDataURL(file)
  })
}

function dirFrom(item) {
  const d = item?.savedDirectory
  if (d === 'EXTERNAL_STORAGE' || d === 'EXTERNAL' ) return Directory.ExternalStorage
  if (d === 'DOCUMENTS') return Directory.Documents
  if (d === 'DATA') return Directory.Data
  return item?.stored === 'native-external' ? Directory.ExternalStorage : Directory.Data
}

export async function deleteNativeFile(item) {
  if (!isNative()) return
  const dir = dirFrom(item)
  if (item?.nativePath) try { await Filesystem.deleteFile({ path: item.nativePath, directory: dir }) } catch {}
  if (item?.thumbPath) try { await Filesystem.deleteFile({ path: item.thumbPath, directory: Directory.Data }) } catch {}
}

export async function readNativeBase64(item) {
  if (!isNative() || !item?.nativePath) return null
  const dir = dirFrom(item)
  const r = await Filesystem.readFile({ path: item.nativePath, directory: dir })
  return r.data
}
