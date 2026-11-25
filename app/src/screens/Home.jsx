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

    if (resolved.length) {
      openPlayer(resolved[0], resolved)
      showToast(resolved.length > 1 ? `${resolved.length} Terabox videos ready` : 'Terabox video ready')
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
