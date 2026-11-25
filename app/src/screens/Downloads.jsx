import React, { useMemo, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { I } from '../components/Icons.jsx'
import { fmtBytes } from '../lib/store.js'
import { importLocalFile, deleteNativeFile, readNativeBase64 } from '../lib/files.js'
import { saveToPhone as exportToPhone } from '../lib/export.js'
import { makeZip } from '../lib/zip.js'

function fmtEta(sec){ sec=Math.max(0,Math.floor(sec||0)); const m=Math.floor(sec/60), s=sec%60; if(m>=60){const h=Math.floor(m/60);return `${h}h ${m%60}m`} return m?`${m}m ${s}s`:`${s}s` }
function blobToBase64(blob){ return new Promise((resolve,reject)=>{ const r=new FileReader(); r.onerror=()=>reject(new Error('read')); r.onload=()=>{ const s=String(r.result||''); resolve(s.includes(',')?s.split(',')[1]:s) }; r.readAsDataURL(blob) }) }

export default function Downloads({ state, save, showToast, openPlayer, setMenu, setConfirm, downloadJobs=[], enqueueDownload, cancelDownload, removeDownloadJob, clearDoneDownloads }) {
  const [q, setQ] = useState('')
  const [provider, setProvider] = useState('ALL')
  const fileRef = useRef()
  const items = useMemo(() => (state.downloads||[]).filter(d => {
    const isLocal = d.kind === 'local' || d.stored === 'web-object-url' || d.stored === 'native-data' || d.nativePath
    const isDownloaded = !!d.downloadedAt || isLocal
    return isDownloaded && (provider==='ALL'||d.provider===provider) && (!q || (d.title||d.name||'').toLowerCase().includes(q.toLowerCase()))
  }), [state.downloads,q,provider])

  const importLocal = async (e) => {
    const files = [...(e.target.files||[])]; e.target.value=''
    if (!files.length) return
    try {
      const medias = []
      for (const f of files) medias.push({ ...(await importLocalFile(f)), createdAt: Date.now() })
      await save({ downloads: [...medias, ...(state.downloads||[])] })
      showToast(`${medias.length} file${medias.length>1?'s':''} added`)
    } catch { showToast('Could not import file') }
  }
  const remove = (item) => setConfirm({
    title:'Delete file', steps:['Delete this file from DiskDrive?', 'Confirm again. This removes it from app storage.'], confirmLabel:'Delete',
    onConfirm: async () => { await deleteNativeFile(item); await save({ downloads: (state.downloads||[]).filter(d=>d.id!==item.id) }); showToast('Deleted') }
  })
  const saveToPhone = async (item) => {
    try {
      const res = await exportToPhone(item, state.settings?.downloadDir || 'Download', { allowRemoteFetch: true })
      showToast(res?.status==='opened'?'Opened in browser': (res?.status==='already' ? 'Already saved locally' : 'Saved to device'))
    } catch (e) {
      showToast(item?.kind==='remote' ? 'Save failed. Use Download queue for remote files.' : 'Could not save file')
    }
  }
  const downloadItem = async (item) => {
    // If local/native file already exists, copy/export it; don't re-download remote
    if (item?.nativePath || item?.stored === 'native-external' || item?.stored === 'app-private' || item?.stored === 'web-object-url') {
      return saveToPhone(item)
    }
    if (enqueueDownload) { enqueueDownload(item); return }
    return saveToPhone(item)
  }
  const getItemBlob = async (item) => {
    if (item?.src?.startsWith('blob:')) return await (await fetch(item.src)).blob()
    if (item?.nativePath) {
      const b64 = await readNativeBase64(item)
      if (!b64) throw new Error('No local file')
      const bin = atob(b64); const bytes = new Uint8Array(bin.length)
      for (let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i)
      return new Blob([bytes], { type: item.type || 'application/octet-stream' })
    }
    const candidates = [item?.src, item?.downloadUrl, item?.directUrl].filter(u => /^https?:|^blob:|^data:/i.test(String(u||'')))
    let lastErr
    for (const u of candidates) {
      try { const r = await fetch(u); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.blob() } catch (e) { lastErr = e }
    }
    throw lastErr || new Error('No file data')
  }

  const saveZip = async (item) => {
    const wantPw = window.confirm('Password protect ZIP?\nOK = Yes, Cancel = No')
    let password = ''
    if (wantPw) {
      password = window.prompt('Enter ZIP password') || ''
      if (!password) return showToast('ZIP password required')
    }
    try {
      showToast('Preparing ZIP…')
      const blob = await getItemBlob(item)
      const name = (item.fileName || item.name || 'video.mp4')
      const zip = await makeZip([{ name, blob }], password ? { password } : {})
      const zipName = name.replace(/\.[^.]+$/, '') + '.zip'
      if (Capacitor.isNativePlatform()) {
        const { Filesystem, Directory } = await import('@capacitor/filesystem')
        const folder = String(state.settings?.downloadDir || 'Download').replace(/[\\/:*?"<>|]+/g,'').trim() || 'Download'
        const dir = state.settings?.downloadStorage === 'device'
          ? { directory: Directory.ExternalStorage, path: `Download/${folder}` }
          : { directory: Directory.Data, path: `downloads/${folder}` }
        try { await Filesystem.mkdir({ path: dir.path, directory: dir.directory, recursive: true }) } catch {}
        const b64 = await blobToBase64(zip)
        await Filesystem.writeFile({ path: `${dir.path}/${zipName}`, data: b64, directory: dir.directory, recursive: true })
        showToast(password ? 'Protected ZIP saved' : 'ZIP saved')
        return
      }
      const a = document.createElement('a')
      const url = URL.createObjectURL(zip)
      a.href = url; a.download = zipName; a.click()
      setTimeout(()=>URL.revokeObjectURL(url), 5000)
      showToast(password ? 'Protected ZIP saved' : 'ZIP saved')
    } catch (e) {
      showToast(item?.kind==='remote' ? 'Remote ZIP may be blocked by CORS. Download in app first.' : 'Could not create ZIP')
    }
  }
  const info = (item) => setMenu({ title:'Info', items:[
    {label:`Name: ${item.name||item.title||'-'}`, onClick:()=>{}},
    {label:`Provider: ${item.provider||'LOCAL'}`, onClick:()=>{}},
    {label:`Size: ${fmtBytes(item.size||0)}`, onClick:()=>{}},
    {label:`Type: ${item.type||'video'}`, onClick:()=>{}},
    {label:`Stored: ${item.stored||'local'}`, onClick:()=>{}},
  ]})

  return <div className="screen">
    <h1>Downloads</h1>
    <p className="lead">Files are kept inside DiskDrive. Plan 1 uses local videos for testing.</p>
    <div className="card">
      <div className="row">
        <input className="input" style={{flex:1}} placeholder="Search downloads" value={q} onChange={e=>setQ(e.target.value)} />
        <input ref={fileRef} type="file" accept="video/*" multiple hidden onChange={importLocal} />
        <button className="btn" onClick={()=>fileRef.current?.click()}>Add local</button>
      </div>
      <div className="chips" style={{marginTop:12,marginBottom:0}}>
        {['ALL','TERABOX','DISKWALA','LOCAL'].map(p=><button key={p} className={`chip ${provider===p?'active':''}`} onClick={()=>setProvider(p)}>{p}</button>)}
      </div>
    </div>

    {downloadJobs.length > 0 && <div className="card">
      <div className="section-title" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><span>Download queue</span><div className="row" style={{gap:6}}>{downloadJobs.some(j=>['error','cancelled'].includes(j.status)) && <button className="btn ghost" style={{padding:'4px 10px',minHeight:30,fontSize:12}} onClick={()=>{ downloadJobs.filter(j=>['error','cancelled'].includes(j.status)).forEach(j=>enqueueDownload?.(j)); }}>Retry failed</button>}{downloadJobs.some(j=>['done','error','cancelled'].includes(j.status)) && <button className="btn ghost" style={{padding:'4px 10px',minHeight:30,fontSize:12}} onClick={()=>clearDoneDownloads?.()}>Clear</button>}</div></div>
      <div className="list">
        {downloadJobs.slice().reverse().map(job => <div className="item" key={job.id} style={{flexDirection:'column',alignItems:'stretch'}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'center'}}>
            <div style={{minWidth:0,flex:1}}>
              <div className="title" style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{job.title||job.name}</div>
              <div className="sub">
                {job.status} {job.progress?`• ${job.progress}%`:''}
                {job.speedBps ? ` • ${(job.speedBps/1048576).toFixed(2)} MB/s` : ''}
                {job.etaSec!=null && ['queued','downloading','resolving'].includes(job.status) ? ` • ETA ${fmtEta(job.etaSec)}` : ''}
                {job.totalBytes ? ` • ${fmtBytes(job.receivedBytes||0)} / ${fmtBytes(job.totalBytes)}` : ''}
                {job.error?` • ${job.error}`:''}
              </div>
            </div>
            <div className="row" style={{gap:6,flex:'0 0 auto'}}>
              {job.savedPath && <div className="sub">Saved</div>}
              {['queued','downloading','resolving'].includes(job.status) && <button className="btn ghost" style={{padding:'6px 10px',minHeight:32}} onClick={()=>cancelDownload?.(job.id)}>Cancel</button>}
              {['error','cancelled','done'].includes(job.status) && <button className="btn ghost" style={{padding:'6px 10px',minHeight:32}} onClick={()=>enqueueDownload?.(job)}>Retry</button>}
              <button className="btn ghost" style={{padding:'6px 10px',minHeight:32,color:'#f88'}} onClick={()=>removeDownloadJob?.(job.id)}>Delete</button>
              <button className="iconbtn" onClick={()=>setMenu({ title: job.title||job.name, items:[
                ...(['queued','downloading','resolving'].includes(job.status) ? [{label:'Stop download', danger:true, onClick:()=>cancelDownload?.(job.id)}] : []),
                ...((job.status==='error' || job.status==='cancelled' || job.status==='done') ? [{label:'Retry download', onClick:()=>enqueueDownload?.(job)}] : []),
                {label:'Copy source link', onClick:async()=>{ try{ await navigator.clipboard.writeText(job.sourceUrl||job.src||''); showToast('Copied') }catch{ showToast('Copy failed') } }},
                {label:'Remove from queue', danger:true, onClick:()=>removeDownloadJob?.(job.id)},
              ]})}><I.dots/></button>
            </div>
          </div>
          <div style={{height:8,background:'#111',border:'1px solid #2a2a2a',borderRadius:999,overflow:'hidden',marginTop:8}}>
            <div style={{width:`${job.progress||0}%`,height:'100%',background: job.status==='error'?'#a33':job.status==='cancelled'?'#666':'#fff',transition:'width .2s'}} />
          </div>
        </div>)}
      </div>
    </div>}

    <div className="card">
      <div className="section-title">Library</div>
      <div className="list">
        {items.length===0 && <div className="empty">No downloads yet. Add a local video to test player, history, playlists and menus.</div>}
        {items.map(item => <div key={item.id} className="item">
          <div className="thumb" onClick={()=>openPlayer(item, items)}>{item.thumb && !String(item.thumb).startsWith('blob:') ? <img src={item.thumb} alt="" /> : <I.play/>}</div>
          <div className="meta" onClick={()=>openPlayer(item, items)}>
            <div className="title">{item.title||item.name}</div>
            <div className="sub">{item.provider||'LOCAL'} • {item.size ? fmtBytes(item.size) : (item.sizeHuman||'Unknown size')}{item.date?` • ${item.date}`:''}{item.savedPath?` • ${item.stored==='app-private'?'In-app':'Device'} saved`:''}</div>
          </div>
          <div className="row" style={{gap:6}}>
            <button className="btn ghost" style={{padding:'8px 10px',minHeight:36}} onClick={()=>downloadItem(item)}>{(item?.nativePath||item?.stored==='app-private'||item?.stored==='native-external')?'Save to phone':'Download'}</button>
            <button className="iconbtn" onClick={()=>setMenu({ title:item.title||item.name, items:[
              {label:'Play in DiskDrive', onClick:()=>openPlayer(item, items)},
              {label:'Open in other player', onClick:()=>window.open(item.directUrl||item.src,'_blank','noopener,noreferrer')},
              ...(item.provider==='TERABOX' && item.kind==='remote' && item.sourceUrl ? [{label:'Copy source link', onClick:async()=>{ try { await navigator.clipboard.writeText(item.sourceUrl); showToast('Copied') } catch { showToast('Copy failed') } }}] : []),
              {label:(item?.nativePath||item?.stored==='app-private'||item?.stored==='native-external')?'Save to phone':'Download in app', onClick:()=>downloadItem(item)},
              {label:'Save to phone (copy)', onClick:()=>saveToPhone(item)},
              {label:'Save as ZIP', onClick:()=>saveZip(item)},
              {label:'Delete', danger:true, onClick:()=>remove(item)},
              {label:'Info', onClick:()=>info(item)},
            ]})}><I.dots/></button>
          </div>
        </div>)}
      </div>
    </div>
  </div>
}
