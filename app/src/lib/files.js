import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { uid } from './id.js'

export const isNative = () => Capacitor.isNativePlatform()
const MEDIA_DIR = 'media'

async function ensureDir() {
  if (!isNative()) return
  try { await Filesystem.mkdir({ path: MEDIA_DIR, directory: Directory.Data, recursive: true }) } catch {}
}

export async function importLocalFile(file) {
  if (!isNative()) {
    const src = URL.createObjectURL(file)
    return { id: uid(), provider:'LOCAL', kind:'local', title:file.name.replace(/\.[^.]+$/,''), name:file.name, src, fileName:file.name, size:file.size||0, type:file.type||'video/*', stored:'web-object-url', addedAt: Date.now() }
  }
  await ensureDir()
  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase()
  const path = `${MEDIA_DIR}/${uid()}.${ext}`
  const data = await fileToBase64(file)
  await Filesystem.writeFile({ path, data, directory: Directory.Data })
  const uri = await Filesystem.getUri({ path, directory: Directory.Data })
  const src = Capacitor.convertFileSrc(uri.uri)
  return { id: uid(), provider:'LOCAL', kind:'native-file', title:file.name.replace(/\.[^.]+$/,''), name:file.name, src, nativePath:path, fileName:file.name, size:file.size||0, type:file.type||'video/*', stored:'app-private', addedAt: Date.now() }
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

export async function deleteNativeFile(item) {
  if (!isNative() || !item?.nativePath) return
  try { await Filesystem.deleteFile({ path: item.nativePath, directory: Directory.Data }) } catch {}
}

export async function readNativeBase64(item) {
  if (!isNative() || !item?.nativePath) return null
  const r = await Filesystem.readFile({ path: item.nativePath, directory: Directory.Data })
  return r.data
}
