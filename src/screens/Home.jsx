import React, { useRef, useState } from 'react'
import { importLocalFile } from '../lib/files.js'

export default function Home({ state, save, showToast, openPlayer, setTab }) {
  const [provider, setProvider] = useState('AUTO')
  const [link, setLink] = useState('')
  const fileRef = useRef()

  const onResolve = () => {
    const v = link.trim()
    if (!v) return showToast('Paste a link or pick a local video')
    if (provider === 'TERABOX' || (provider === 'AUTO' && /tera|1024terabox|terabox/i.test(v))) return showToast('Coming in Plan 2')
    if (provider === 'DISKWALA' || /diskwala/i.test(v)) return showToast('Coming in Plan 3')
    showToast('Coming in Plan 2')
  }
  const onLocal = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const media = await importLocalFile(file)
      const downloads = [ { ...media, createdAt: Date.now() }, ...(state.downloads||[]) ]
      await save({ downloads })
      openPlayer(media, [media])
    } catch { showToast('Could not open file') }
  }

  return <div className="screen">
    <h1>Play anything. Keep it private.</h1>
    <p className="lead">DiskDrive is built for local playback first. Terabox and DiskWala links are visible now and will be connected in upcoming plans.</p>

    <div className="card">
      <div className="chips">
        {['TERABOX','DISKWALA','AUTO'].map(p => <button key={p} className={`chip ${provider===p?'active':''}`} onClick={()=>setProvider(p)}>{p==='AUTO'?'AUTO DETECT':p}</button>)}
      </div>
      <div className="row" style={{alignItems:'stretch'}}>
        <input className="input" style={{flex:1}} value={link} onChange={e=>setLink(e.target.value)} placeholder="Paste a Terabox or DiskWala link" />
        <button className="btn" onClick={onResolve} style={{minWidth:88}}>Add</button>
      </div>
      <div className="small" style={{marginTop:10}}>Plan 1: link resolve is not connected. Local videos work fully.</div>
    </div>

    <div className="card">
      <div className="section-title">Local video</div>
      <p className="lead" style={{marginBottom:14}}>Play a video from your device in the DiskDrive player.</p>
      <input ref={fileRef} type="file" accept="video/*" hidden onChange={onLocal} />
      <div className="row">
        <button className="btn" onClick={()=>fileRef.current?.click()}>Play a local video</button>
        <button className="btn ghost" onClick={()=>setTab('download')}>Your downloads</button>
      </div>
    </div>
  </div>
}
