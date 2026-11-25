import React, { useMemo, useRef, useState } from 'react'
import { I } from '../components/Icons.jsx'
import { fmtBytes } from '../lib/store.js'
import { importLocalFile, deleteNativeFile } from '../lib/files.js'
import { saveToPhone as exportToPhone } from '../lib/export.js'
import { makeZip } from '../lib/zip.js'

export default function Downloads({ state, save, showToast, openPlayer, setMenu, setConfirm }) {
  const [q, setQ] = useState('')
  const [provider, setProvider] = useState('ALL')
  const fileRef = useRef()
  const items = useMemo(() => (state.downloads||[]).filter(d => (provider==='ALL'||d.provider===provider) && (!q || (d.title||d.name||'').toLowerCase().includes(q.toLowerCase()))), [state.downloads,q,provider])

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
    try { await exportToPhone(item); showToast('Saved to device') } catch { showToast('Could not save file') }
  }
  const saveZip = async (item) => {
    const wantPw = window.confirm('Password protect ZIP?\nOK = Yes, Cancel = No')
    let password = ''
    if (wantPw) {
      password = window.prompt('Enter ZIP password') || ''
      if (!password) return showToast('ZIP password required')
    }
    try {
      const blob = item?.src?.startsWith('blob:') ? await (await fetch(item.src)).blob() : await (await fetch(item.src)).blob()
      const name = (item.fileName || item.name || 'video.mp4')
      const zip = await makeZip([{ name, blob }], password ? { password } : {})
      const a = document.createElement('a')
      const url = URL.createObjectURL(zip)
      a.href = url; a.download = name.replace(/\.[^.]+$/, '') + '.zip'; a.click()
      setTimeout(()=>URL.revokeObjectURL(url), 5000)
      showToast(password ? 'Protected ZIP saved' : 'ZIP saved')
    } catch (e) {
      showToast('Could not create ZIP')
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

    <div className="card">
      <div className="section-title">Library</div>
      <div className="list">
        {items.length===0 && <div className="empty">No downloads yet. Add a local video to test player, history, playlists and menus.</div>}
        {items.map(item => <div key={item.id} className="item">
          <div className="thumb" onClick={()=>openPlayer(item, items)}>{item.thumb && !String(item.thumb).startsWith('blob:') ? <img src={item.thumb} alt="" /> : <I.play/>}</div>
          <div className="meta" onClick={()=>openPlayer(item, items)}>
            <div className="title">{item.title||item.name}</div>
            <div className="sub">{item.provider||'LOCAL'} • {fmtBytes(item.size||0)}</div>
          </div>
          <button className="iconbtn" onClick={()=>setMenu({ title:item.title||item.name, items:[
            {label:'Save to phone', onClick:()=>saveToPhone(item)},
            {label:'Save as ZIP', onClick:()=>saveZip(item)},
            {label:'Delete', danger:true, onClick:()=>remove(item)},
            {label:'Info', onClick:()=>info(item)},
          ]})}><I.dots/></button>
        </div>)}
      </div>
    </div>
  </div>
}
