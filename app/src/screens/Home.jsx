import React, { useRef, useState } from 'react'
import { importLocalFile } from '../lib/files.js'
import { isTeraboxUrl, resolveTeraboxLink } from '../lib/terabox.js'

export default function Home({ state, save, showToast, openPlayer, setTab, addDownload }) {
  const [provider, setProvider] = useState('AUTO')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef()

  const onResolve = async () => {
    const v = link.trim()
    if (!v) return showToast('Paste a link or pick a local video')
    if (provider === 'DISKWALA' || /diskwala/i.test(v)) return showToast('Coming soon')
    const isTerabox = provider === 'TERABOX' || (provider === 'AUTO' && (isTeraboxUrl(v) || /tera|1024terabox|terabox/i.test(v)))
    if (isTerabox) {
      setBusy(true)
      try {
        const media = await resolveTeraboxLink(v, {
          resolverUrl: state.settings?.resolverUrl || '',
          resolverKey: state.settings?.resolverKey || '',
        })
        const item = { ...media, id: media.id || (crypto?.randomUUID?.() || String(Date.now())), createdAt: Date.now() }
        await addDownload?.(item)
        openPlayer(item, [item])
        showToast('Terabox video ready')
      } catch (e) {
        showToast(String(e?.message || e || 'Could not resolve Terabox link'))
      } finally {
        setBusy(false)
      }
      return
    }
    showToast('Unsupported link. Terabox works now; DiskWala coming soon.')
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
    <p className="lead">Play local videos and Terabox links. DiskWala is coming soon.</p>

    <div className="card">
      <div className="chips">
        {['TERABOX','DISKWALA','AUTO'].map(p => <button key={p} className={`chip ${provider===p?'active':''}`} onClick={()=>setProvider(p)}>{p==='AUTO'?'AUTO DETECT':p}</button>)}
      </div>
      <div className="row" style={{alignItems:'stretch'}}>
        <input className="input" style={{flex:1}} value={link} onChange={e=>setLink(e.target.value)} placeholder="Paste a Terabox or DiskWala link" />
        <button className="btn" onClick={onResolve} style={{minWidth:88}} disabled={busy}>{busy?'Resolving…':'Add'}</button>
      </div>
      <div className="small" style={{marginTop:10}}>Terabox works through your resolver URL in Settings. NDUS stays on server. DiskWala coming soon.</div>
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
