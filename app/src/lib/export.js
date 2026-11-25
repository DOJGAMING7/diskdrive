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

async function getBlob(item) {
  if (item?.src?.startsWith('blob:')) return await (await fetch(item.src)).blob()
  if (Capacitor.isNativePlatform() && item?.nativePath) {
    const b64 = await readNativeBase64(item)
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i)
    return new Blob([bytes], { type: item.type || 'application/octet-stream' })
  }
  if (item?.src) return await (await fetch(item.src)).blob()
  throw new Error('No file data')
}

export async function saveToPhone(item) {
  const blob = await getBlob(item)
  const name = item.fileName || item.name || 'video.mp4'
  if (!Capacitor.isNativePlatform()) { downloadBlob(blob, name); return 'saved' }
  const b64 = await blobToBase64(blob)
  const path = `DiskDrive/${name}`
  try { await Filesystem.mkdir({ path:'DiskDrive', directory: Directory.Documents, recursive:true }) } catch {}
  await Filesystem.writeFile({ path, data: b64, directory: Directory.Documents, recursive: true })
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
