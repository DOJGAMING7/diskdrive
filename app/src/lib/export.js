import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { readNativeBase64 } from './files.js'

function downloadBlob(blob, name) {
  const a = document.createElement('a')
  const url = URL.createObjectURL(blob)
  a.href = url; a.download = name; a.click()
  setTimeout(()=>URL.revokeObjectURL(url), 5000)
}

async function fetchAsBlob(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.blob()
}

async function getBlob(item) {
  if (item?.src?.startsWith('blob:')) return await (await fetch(item.src)).blob()
  if (Capacitor.isNativePlatform() && item?.nativePath) {
    const b64 = await readNativeBase64(item)
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i)
    return new Blob([bytes], { type: item.type || 'application/octet-stream' })
  }
  const candidates = [item?.downloadUrl, item?.directUrl, item?.src].filter(Boolean)
  let lastErr
  for (const u of candidates) {
    try { return await fetchAsBlob(u) } catch (e) { lastErr = e }
  }
  throw lastErr || new Error('No file data')
}

export async function saveToPhone(item, dirName = 'DiskDrive') {
  const name = item.fileName || item.name || 'video.mp4'
  const folder = String(dirName || 'DiskDrive').replace(/[\\/:*?"<>|]+/g, '').trim() || 'DiskDrive'
  if (!Capacitor.isNativePlatform()) {
    try {
      const blob = await getBlob(item)
      downloadBlob(blob, name)
      return 'saved'
    } catch {
      const url = item?.downloadUrl || item?.directUrl || item?.src
      if (url) { window.open(url, '_blank', 'noopener,noreferrer'); return 'opened' }
      throw new Error('No file data')
    }
  }
  try { await Filesystem.mkdir({ path: folder, directory: Directory.Documents, recursive:true }) } catch {}
  const dest = `${folder}/${name}`
  const remoteUrl = item?.downloadUrl || item?.directUrl || (!item?.nativePath ? item?.src : null)
  if (remoteUrl && /^https?:/i.test(remoteUrl)) {
    try {
      const res = await Filesystem.downloadFile({ url: remoteUrl, path: dest, directory: Directory.Documents, progress: false })
      if (res?.path || res) return 'saved'
    } catch {}
  }
  const blob = await getBlob(item)
  const b64 = await blobToBase64(blob)
  await Filesystem.writeFile({ path: dest, data: b64, directory: Directory.Documents, recursive: true })
  return 'saved'
}

export async function shareItem(item) {
  if (!Capacitor.isNativePlatform()) {
    if (navigator.share && item.src && !item.src.startsWith('blob:')) { await navigator.share({ title:item.title, url:item.src }); return }
    downloadBlob(await getBlob(item), item.fileName||item.name||'video.mp4')
    return
  }
  const blob = await getBlob(item)
  const b64 = await blobToBase64(blob)
  const cachePath = `share/${item.fileName||item.name||'video.mp4'}`
  try { await Filesystem.mkdir({ path:'share', directory: Directory.Cache, recursive:true }) } catch {}
  await Filesystem.writeFile({ path: cachePath, data:b64, directory: Directory.Cache, recursive:true })
  const uri = await Filesystem.getUri({ path: cachePath, directory: Directory.Cache })
  await Share.share({ title: item.title || item.name, url: uri.uri, dialogTitle: 'Share video' })
}

function blobToBase64(blob) {
  return new Promise((resolve,reject)=>{ const r=new FileReader(); r.onerror=()=>reject(new Error('read')); r.onload=()=>{ const s=String(r.result||''); resolve(s.includes(',')?s.split(',')[1]:s) }; r.readAsDataURL(blob) })
}
