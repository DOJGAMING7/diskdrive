import React, { useRef, useState } from 'react'
import { importLocalFile } from '../lib/files.js'
import { isTeraboxUrl, resolveTeraboxLink } from '../lib/terabox.js'
import { uid } from '../lib/id.js'

function extractLinks(text='') {
  const raw = String(text || '')
  const urls = raw.match(/https?:\/\/[^\s<>"')\]]+/ig) || []
  const cleaned = urls.map(u => u.replace(/[),.;!?]+$/g, '').trim())
  return [...new Set(cleaned)]
}

function guessTitle(text, url) {
  const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  const nonUrl = lines.find(l => !/^https?:\/\//i.test(l) && !l.includes(url))
  return nonUrl || ''
}

export default function Home({ state, save, showToast, openPlayer, setTab, addDownload }) {
  const [provider, setProvider] = useState('AUTO')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ active:false, total:0, done:0, current:'', errors:[] })
  const [resolvedItems, setResolvedItems] = useState([])
  const fileRef = useRef()

  const onResolve = async () => {
    const text = link.trim()
    if (!text) return showToast('Paste a link or pick a local video')
    const links = extractLinks(text)
    if (!links.length) {
      if (/diskwala/i.test(text) || provider === 'DISKWALA') return showToast('Coming soon')
      return showToast('No link found in your message')
    }

    const jobs = links.map(url => ({ url, provider: /diskwala/i.test(url) ? 'DISKWALA' : (isTeraboxUrl(url) ? 'TERABOX' : 'UNKNOWN') }))
    const diskwala = jobs.filter(j => j.provider === 'DISKWALA')
    const terabox = jobs.filter(j => j.provider === 'TERABOX')
    const unknown = jobs.filter(j => j.provider === 'UNKNOWN')

    if (provider === 'DISKWALA' || (diskwala.length && !terabox.length)) return showToast('DiskWala coming soon')
    if (!terabox.length) return showToast('Unsupported link. Terabox works now; DiskWala coming soon.')

    setBusy(true)
    setProgress({ active:true, total: terabox.length, done:0, current:'Starting…', errors: diskwala.length ? ['DiskWala links skipped (coming soon)'] : [] })
    const resolved = []
    const errors = diskwala.length ? ['DiskWala links skipped (coming soon)'] : []

    for (let i = 0; i < terabox.length; i++) {
      const job = terabox[i]
      const label = guessTitle(text, job.url) || job.url
      setProgress(p => ({ ...p, done: i, current: `Resolving ${i + 1}/${terabox.length}: ${label.slice(0, 60)}` }))
      try {
        const media = await resolveTeraboxLink(job.url, {
          resolverUrl: state.settings?.resolverUrl || '',
          resolverKey: state.settings?.resolverKey || '',
        })
        const title = media.title || guessTitle(text, job.url) || media.name
        const item = { ...media, id: uid(), title, name: media.name || title, createdAt: Date.now() }
        resolved.push(item)
        await addDownload?.(item)
      } catch (e) {
        errors.push(`${job.url.slice(0, 50)}…: ${String(e?.message || e).slice(0, 140)}`)
      }
      setProgress(p => ({ ...p, done: i + 1, current: `Processed ${i + 1}/${terabox.length}` }))
    }

    if (unknown.length) errors.push(`${unknown.length} unsupported link(s) skipped`)
    setProgress({ active:false, total: terabox.length, done: terabox.length, current:'Done', errors })
    setBusy(false)

    setResolvedItems(resolved)
    if (resolved.length) {
      if (resolved.length > 1) {
        showToast(`${resolved.length} Terabox videos ready`)
      } else {
        showToast('Terabox video ready')
      }
    } else {
      showToast(errors[0] || 'Could not resolve Terabox link')
    }
  }

  const onLocal = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const media = await importLocalFile(file)
      const downloads = [{ ...media, createdAt: Date.now() }, ...(state.downloads || [])]
      await save({ downloads })
      openPlayer(media, [media])
    } catch { showToast('Could not open file') }
  }

  const downloadOne = async (item) => {
    const url = item.downloadUrl || item.directUrl || item.src
    if (!url) return showToast('No download URL')
    try {
      const a = document.createElement('a')
      a.href = url
      a.download = item.name || 'video.mp4'
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  const downloadAll = async () => {
    if (!resolvedItems.length) return
    showToast(`Starting ${resolvedItems.length} downloads`)
    for (const item of resolvedItems) {
      await downloadOne(item)
      await new Promise(r => setTimeout(r, 350))
    }
  }

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  return <div className="screen">
    <h1>Play anything. Keep it private.</h1>
    <p className="lead">Play local videos and Terabox links. DiskWala is coming soon.</p>

    <div className="card">
      <div className="chips">
        {['TERABOX', 'DISKWALA', 'AUTO'].map(p => <button key={p} className={`chip ${provider === p ? 'active' : ''}`} onClick={() => setProvider(p)}>{p === 'AUTO' ? 'AUTO DETECT' : p}</button>)}
      </div>
      <textarea className="input" style={{ minHeight: 96, resize: 'vertical' }} value={link} onChange={e => setLink(e.target.value)} placeholder={'Paste Terabox link(s) or message text.\nExample:\nDhurandhar 2026 Hindi\nhttps://1024terabox.com/s/...'} />
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" onClick={onResolve} disabled={busy} style={{ minWidth: 120 }}>{busy ? 'Resolving…' : 'Add / Resolve'}</button>
        <button className="btn ghost" onClick={() => { setLink(''); setProgress({ active:false,total:0,done:0,current:'',errors:[] }) }} disabled={busy}>Clear</button>
      </div>
      <div className="small" style={{ marginTop: 10 }}>Supports multiple Terabox links in one message. Terabox resolves through your resolver URL in Settings. NDUS stays on server. DiskWala coming soon.</div>

      {(busy || progress.total > 0) && <div style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#ddd', marginBottom: 6 }}>
          <span>{progress.current || 'Ready'}</span><span>{progress.done}/{progress.total}</span>
        </div>
        <div style={{ height: 10, background: '#111', border: '1px solid #2a2a2a', borderRadius: 999, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: '#fff', transition: 'width .25s ease' }} />
        </div>
        {progress.errors?.length > 0 && <div style={{ marginTop: 10, fontSize: 12, color: '#ddd', whiteSpace: 'pre-wrap' }}>{progress.errors.slice(-3).join('\n')}</div>}
      </div>}
    </div>

    {resolvedItems.length > 0 && <div className="card">
      <div className="section-title">{resolvedItems.length > 1 ? `Playlist ready (${resolvedItems.length})` : 'File ready'}</div>
      <p className="small" style={{marginTop:0}}>{resolvedItems.length > 1 ? 'Play all in DiskDrive player, or download files one by one.' : 'Choose how you want to open or download this file.'}</p>
      <div className="row" style={{marginBottom:12}}>
        {resolvedItems.length > 1 ? <button className="btn" onClick={()=>openPlayer(resolvedItems[0], resolvedItems)}>Play playlist</button> : <button className="btn" onClick={()=>openPlayer(resolvedItems[0], resolvedItems)}>View in player</button>}
        {resolvedItems.length === 1 && <button className="btn ghost" onClick={()=>window.open(resolvedItems[0].directUrl || resolvedItems[0].src, '_blank', 'noopener,noreferrer')}>Open in other player</button>}
        {resolvedItems.length === 1 ? <button className="btn ghost" onClick={()=>downloadOne(resolvedItems[0])}>Download</button> : <button className="btn ghost" onClick={downloadAll}>Download all (single files)</button>}
      </div>
      <div className="list">
        {resolvedItems.map((item, i) => <div className="item" key={item.id || i}>
          <div className="meta">
            <div className="title" style={{whiteSpace:'normal'}}>{item.title || item.name}</div>
            <div className="sub">{item.sizeHuman || ''}{item.date ? ` • ${item.date}` : ''}</div>
          </div>
          {resolvedItems.length > 1 && <div className="row" style={{gap:8}}>
            <button className="btn ghost" onClick={()=>openPlayer(item, resolvedItems)}>Play</button>
            <button className="btn ghost" onClick={()=>downloadOne(item)}>Download</button>
          </div>}
        </div>)}
      </div>
    </div>}

    <div className="card">
      <div className="section-title">Local video</div>
      <p className="lead" style={{ marginBottom: 14 }}>Play a video from your device in the DiskDrive player.</p>
      <input ref={fileRef} type="file" accept="video/*" hidden onChange={onLocal} />
      <div className="row">
        <button className="btn" onClick={() => fileRef.current?.click()}>Play a local video</button>
        <button className="btn ghost" onClick={() => setTab('download')}>Your downloads</button>
      </div>
    </div>
  </div>
}
