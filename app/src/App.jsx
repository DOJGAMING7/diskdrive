import React, { useEffect, useRef, useState } from 'react'
import { I } from './components/Icons.jsx'
import { loadState, persist } from './lib/store.js'
import { sha256, verifyHash } from './lib/hash.js'
import { uid, now } from './lib/id.js'
import { initNative, onAppState } from './lib/native.js'
import { checkAndUpdateBundle, getBundleMeta, getCachedBundleUrl } from './lib/updater.js'
import { createDownloadManager } from './lib/downloadManager.js'
import { resolveTeraboxLink } from './lib/terabox.js'
import { withTimeout, bootStatus } from './lib/async.js'
import { generateThumbnail, persistThumbnail, resolveThumb } from './lib/thumb.js'
import Player from './components/Player.jsx'
import MenuModal from './components/MenuModal.jsx'
import ConfirmModal from './components/ConfirmModal.jsx'
import AdminGate from './components/AdminGate.jsx'
import PinLock from './components/PinLock.jsx'
import Home from './screens/Home.jsx'
import Downloads from './screens/Downloads.jsx'
import HistoryScreen from './screens/History.jsx'
import PlaylistScreen from './screens/Playlists.jsx'
import SettingsScreen from './screens/Settings.jsx'

const ADMIN_HASH = '39bbd73f3d1c588cb28df7be03bc0a45993d2973d3c0ba23ad74095cc00204fa'
const TABS = [
  { id:'home', label:'HOME', icon:I.home },
  { id:'download', label:'DOWNLOAD', icon:I.download },
  { id:'history', label:'HISTORY', icon:I.history },
  { id:'playlist', label:'PLAYLIST', icon:I.playlist },
  { id:'settings', label:'SETTINGS', icon:I.settings },
]

export default function App() {
  const [ready, setReady] = useState(false)
  const [bootMsg, setBootMsg] = useState('Loading…')
  const [tab, setTab] = useState('home')
  const [toast, setToast] = useState('')
  const [state, setState] = useState({ adminUnlocked:false, adminHash:null, pinHash:null, pinEnabled:false, lockDelay:15, history:[], playlists:[{id:"watch-later",name:"WATCH LATER",builtIn:true,items:[],updatedAt:Date.now()},{id:"favourites",name:"FAVOURITES",builtIn:true,items:[],updatedAt:Date.now()}], downloads:[], settings:{lockDelaySec:15,pinEnabled:false,lastSaveDir:null,downloadDir:"Download",downloadStorage:"inapp",serverUrl:"",serverLocked:false,teraboxCookie:"",teraboxLocked:false,teraboxResolverMode:"device",teraboxLog:[],updateLog:[]} })
  const [adminInput, setAdminInput] = useState('')
  const [adminErr, setAdminErr] = useState('')
  const [adminAttempts, setAdminAttempts] = useState(0)
  const [adminWaitUntil, setAdminWaitUntil] = useState(0)
  const [pinInput, setPinInput] = useState('')
  const [pinErr, setPinErr] = useState('')
  const [locked, setLocked] = useState(false)
  const [playerItem, setPlayerItem] = useState(null)
  const [playerQueue, setPlayerQueue] = useState([])
  const [menu, setMenu] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [bundleStatus, setBundleStatus] = useState(null)
  const [resolveState, setResolveState] = useState({ provider:'AUTO', link:'', busy:false, progress:{ active:false,total:0,done:0,current:'',errors:[] }, resolvedItems:[] })
  const [downloadJobs, setDownloadJobs] = useState([])
  const downloadMgr = useRef(null)
  const teraboxCfg = useRef({ teraboxCookie:'' })
  const lockTimer = useRef(null)
  const lastActive = useRef(Date.now())

  useEffect(() => { teraboxCfg.current = { teraboxCookie: state?.settings?.teraboxCookie || '' } }, [state?.settings?.teraboxCookie])

  useEffect(() => {
    if (downloadMgr.current) return
    downloadMgr.current = createDownloadManager({
      onUpdate: (jobs) => setDownloadJobs(jobs),
      onComplete: (job) => {
        if (job.status === 'done') {
          const localSrc = job.srcLocal || job.nativeUri || job.downloadUrl || job.directUrl || job.src
          const item = {
            id: job.itemId || uid(), title: job.title, name: job.name, fileName: job.fileName,
            provider: job.provider || 'TERABOX',
            kind: 'local',
            src: localSrc,
            nativePath: job.nativePath || job.savedPath || null,
            directUrl: job.directUrl, downloadUrl: job.downloadUrl, sourceUrl: job.sourceUrl,
            thumb: job.thumb, thumbPath: job.thumbPath, date: job.date,
            size: Number(job.totalBytes || job.size || 0) || 0, sizeHuman: job.sizeHuman,
            downloadedAt: Date.now(), savedPath: job.savedPath, savedDirectory: job.savedDirectory, stored: job.stored || 'downloaded'
          }
          addDownload(item)
          showToast(`Downloaded: ${job.title || job.name}`)
        } else if (job.status === 'error') {
          showToast(`Download failed: ${job.error?.slice(0,60) || 'error'}`)
        }
      },
      getSettings: () => ({ nativeDownload: true }),
      getTeraboxCookie: () => stateRef.current?.settings?.teraboxCookie || '',
      resolveItem: async (job) => {
        if (!job.sourceUrl) throw new Error('No source URL to re-resolve')
        const cfg = teraboxCfg.current
        const r = await resolveTeraboxLink(job.sourceUrl, { teraboxCookie: cfg.teraboxCookie || stateRef.current?.settings?.teraboxCookie || '' })
        return r
      }
    })
    setDownloadJobs(downloadMgr.current.getAll())
  }, [])

  const setBoot = (msg) => { setBootMsg(msg); bootStatus(msg) }
  useEffect(() => { withTimeout(initNative(), 3000, 'native init').catch((e)=>console.warn(e)) }, [])
  useEffect(() => { (async () => {
    try {
      setBoot('Loading saved data…')
      const s = await withTimeout(loadState(), 3000, 'load state').catch((e)=>{ console.warn(e); return null })
      const safe = s || { adminUnlocked:false, adminHash:null, pinHash:null, pinEnabled:false, lockDelay:15, history:[], playlists:[{id:'watch-later',name:'WATCH LATER',builtIn:true,items:[],updatedAt:Date.now()},{id:'favourites',name:'FAVOURITES',builtIn:true,items:[],updatedAt:Date.now()}], downloads:[], settings:{lockDelaySec:15,pinEnabled:false,lastSaveDir:null,downloadDir:'Download',downloadStorage:'inapp',serverLocked:false,serverUrl:'',teraboxCookie:'',teraboxResolverMode:'device',updateLog:[]} }
      const serverUrl = safe?.settings?.serverUrl || ''
      if (serverUrl) {
        setBoot('Checking UI updates…')
        try {
          const res = await withTimeout(checkAndUpdateBundle(serverUrl), 4000, 'ui update check')
          const meta = await withTimeout(getBundleMeta(), 1500, 'bundle meta').catch(()=>null)
          setBundleStatus({ ...res, meta })
          const cachedUrl = await withTimeout(getCachedBundleUrl(), 1500, 'cached bundle').catch(()=>null)
          const params = new URLSearchParams(location.search)
          const allowCached = !params.has('bundled')
          const alreadyCached = sessionStorage.getItem('dd_using_cached_bundle') === '1'
          if (cachedUrl && allowCached && !alreadyCached && (res.status === 'updated' || res.status === 'up-to-date' || res.status === 'offline')) {
            sessionStorage.setItem('dd_using_cached_bundle', '1')
            location.replace(cachedUrl + (cachedUrl.includes('?') ? '&' : '?') + 'cached=1')
            return
          }
        } catch (e) {
          console.warn('bundle update failed', e)
          setBundleStatus({ status:'offline', error: String(e?.message||e) })
        }
      } else {
        try { setBundleStatus({ status:'no-server', meta: await withTimeout(getBundleMeta(), 1500, 'bundle meta') }) } catch {}
      }
      setBoot('Starting interface…')
      setState(safe)
      setReady(true)
      window.__diskdriveMounted = true
      if (safe.adminUnlocked && safe.pinEnabled && safe.pinHash) setLocked(true)
    } catch (e) {
      console.error(e)
      window.__diskdriveShowError?.(e?.stack || e?.message || String(e))
      setBootMsg('Startup failed.')
    }
  })() }, [])

  useEffect(() => { if (!toast) return; const t=setTimeout(()=>setToast(''),2200); return ()=>clearTimeout(t) }, [toast])

  useEffect(() => {
    if (!state?.adminUnlocked) return
    const off = onAppState(({ isActive }) => {
      if (isActive) {
        clearTimeout(lockTimer.current)
        const away = Date.now() - lastActive.current
        if (state.pinEnabled && state.pinHash && away >= (state.lockDelay || 15) * 1000) setLocked(true)
      } else {
        lastActive.current = Date.now()
        clearTimeout(lockTimer.current)
        lockTimer.current = setTimeout(() => { lastActive.current = Date.now() - (state.lockDelay || 15) * 1000 }, (state.lockDelay || 15) * 1000)
      }
    })
    return () => { clearTimeout(lockTimer.current); off?.() }
  }, [state?.adminUnlocked, state?.pinEnabled, state?.pinHash, state?.lockDelay])

  const save = async (patch) => {
    setState(prev => {
      const base = prev || {}
      const next = { ...base, ...patch }
      for (const k of Object.keys(patch)) {
        if (persist[k]) withTimeout(persist[k](patch[k]), 3000, `save ${k}`).catch((e)=>console.warn('persist failed', k, e))
      }
      return next
    })
  }
  const showToast = (msg) => setToast(msg)

  useEffect(() => {
    if (!ready || !state) return
    window.__diskdriveFirstScreen = true
    window.__diskdriveHideBoot?.()
  }, [ready, state, state?.adminUnlocked, locked, tab])

  const thumbJobs = useRef(new Set())
  useEffect(() => {
    if (!ready) return
    const items = [...(state.downloads||[]), ...(state.history||[]), ...((state.playlists||[]).flatMap(p=>p.items||[]))]
    for (const item of items) {
      const src = item?.src
      const hasThumb = item?.thumb && !String(item.thumb).startsWith('blob:')
      if (!src || hasThumb) continue
      if (String(src).startsWith('blob:')) continue
      const key = item.thumbPath || item.id || src
      if (thumbJobs.current.has(key)) continue
      thumbJobs.current.add(key)
      ;(async () => {
        try {
          const dataUrl = await generateThumbnail(src)
          if (!dataUrl) return
          const saved = await persistThumbnail(dataUrl, item.id || uid())
          if (!saved?.thumb) return
          setState(prev => {
            const base = prev || {}
            const patchList = (list=[]) => list.map(x => (x.id===item.id || x.src===src) ? { ...x, thumb: saved.thumb, thumbPath: saved.thumbPath || x.thumbPath || null } : x)
            const downloads = patchList(base.downloads||[])
            const history = patchList(base.history||[])
            const playlists = (base.playlists||[]).map(p => ({ ...p, items: patchList(p.items||[]) }))
            withTimeout(persist.downloads(downloads),3000,'save downloads').catch(()=>{})
            withTimeout(persist.history(history),3000,'save history').catch(()=>{})
            withTimeout(persist.playlists(playlists),3000,'save playlists').catch(()=>{})
            return { ...base, downloads, history, playlists }
          })
        } catch {}
        finally { thumbJobs.current.delete(key) }
      })()
    }
  }, [ready, state.downloads, state.history, state.playlists])

  const openPlayer = (item, queue=[]) => {
    if (!item) return
    const q = Array.isArray(queue) && queue.length ? queue : [item]
    setPlayerQueue(q)
    setPlayerItem({ ...item })
    setState(prev => {
      const base = prev || {}
      const existing = (base.history||[]).find(h => (item.sourceUrl && h.sourceUrl === item.sourceUrl) || (h.src && h.src === item.src))
      const entry = { id: existing?.id || uid(), mediaId: item.id, provider: item.provider || 'LOCAL', title: item.title || item.name, name: item.name, src: item.src, sourceUrl: item.sourceUrl || existing?.sourceUrl || '', thumb: item.thumb || existing?.thumb || '', thumbPath: item.thumbPath || existing?.thumbPath || null, kind: item.kind||'local', watchedAt: now(), position: existing?.position || item.position || 0, duration: existing?.duration || item.duration || 0, watchCount: (existing?.watchCount || 0) + 1 }
      const history = [entry, ...(base.history||[]).filter(h => !((item.sourceUrl && h.sourceUrl===item.sourceUrl) || (h.src && h.src===item.src)))].slice(0,200)
      withTimeout(persist.history(history), 3000, 'save history').catch(console.warn)
      return { ...base, history }
    })
  }
  const lastPosSave = useRef(0)
  const updateHistoryPos = (src, position, duration, force=false) => {
    if (!src) return
    const t = Date.now()
    if (!force && t - lastPosSave.current < 5000) return
    lastPosSave.current = t
    setState(prev => {
      const base = prev || {}
      const history = (base.history||[]).map(h => h.src===src ? { ...h, position, duration: duration||h.duration, watchedAt: now() } : h)
      withTimeout(persist.history(history), 3000, 'save history pos').catch(console.warn)
      return { ...base, history }
    })
  }

  const addDownload = async (item) => {
    setState(prev => {
      const base = prev || {}
      const prevItem = (base.downloads||[]).find(d => (item.id && d.id===item.id) || (item.sourceUrl && d.sourceUrl===item.sourceUrl) || (item.src && d.src===item.src))
      const merged = { ...(prevItem||{}), ...item, id: item.id || prevItem?.id || uid(), createdAt: prevItem?.createdAt || item.createdAt || Date.now(), downloadedAt: item.downloadedAt || Date.now() }
      if (!merged.size && prevItem?.size) merged.size = prevItem.size
      const downloads = [merged, ...(base.downloads||[]).filter(d => d.id !== merged.id && !(merged.sourceUrl && d.sourceUrl===merged.sourceUrl) && !(merged.src && d.src===merged.src))]
      withTimeout(persist.downloads(downloads), 3000, 'save downloads').catch(console.warn)
      return { ...base, downloads }
    })
  }

  const enqueueDownload = (item) => {
    const dir = state?.settings?.downloadDir || 'Download'
    const storageMode = state?.settings?.downloadStorage || 'inapp'
    if (!downloadMgr.current) { showToast('Download manager not ready'); return null }
    const res = downloadMgr.current.enqueue({ ...item, teraboxCookie: state?.settings?.teraboxCookie || '' }, dir, storageMode)
    if (res?.deduped) showToast(`Already in queue (${res.status})`)
    else showToast(storageMode === 'device' ? 'Download queued (device folder)' : 'Download queued (in-app storage)')
    return res
  }
  const cancelDownload = (id) => { downloadMgr.current?.cancel(id); showToast('Download cancelled') }
  const removeDownloadJob = (id) => { downloadMgr.current?.remove(id); showToast('Download removed') }
  const clearDoneDownloads = () => { downloadMgr.current?.clearDone() }
  const getActiveDownload = (item) => downloadMgr.current?.getActiveForItem(item) || null

  useEffect(() => {
    const h = () => clearDoneDownloads()
    window.addEventListener('dd-clear-downloads', h)
    return () => window.removeEventListener('dd-clear-downloads', h)
  }, [])

  if (!ready) return <div className="overlay" style={{background:'#000',color:'#fff'}}><div className="panel" style={{background:'#0a0a0a',color:'#fff'}}><h2 style={{color:'#fff'}}>DISKDRIVE</h2><p style={{color:'#ddd'}}>{bootMsg}</p><div className="small" style={{marginTop:12,color:'#bbb'}}>If startup is stuck, wait a few seconds for the error screen.</div></div></div>

  if (!state.adminUnlocked) return <AdminGate input={adminInput} setInput={setAdminInput} err={adminErr} attempts={adminAttempts} waitUntil={adminWaitUntil} onSubmit={async ()=>{
    if (Date.now() < adminWaitUntil) return
    const inputHash = await withTimeout(sha256(adminInput), 3000, 'hash admin password').catch(()=>null)
    const ok = !!inputHash && inputHash === ADMIN_HASH
    if (!ok) { const n=adminAttempts+1; setAdminAttempts(n); setAdminErr('Invalid password'); if (n>=5) { setAdminWaitUntil(Date.now()+30000); setAdminErr('Too many attempts. Wait 30 seconds.') } return }
    await save({ adminUnlocked: true, adminHash: ADMIN_HASH })
    setAdminErr('')
  }} />

  if (locked && state.pinEnabled && state.pinHash) return <PinLock mode="unlock" pin={pinInput} setPin={setPinInput} err={pinErr} onBack={()=>{}} onDone={async (pin)=>{
    try {
      const ok = await withTimeout(verifyHash(pin, state.pinHash), 3000, 'verify pin')
      if (!ok) { setPinErr('Wrong PIN'); setPinInput(''); return }
      setPinErr(''); setPinInput(''); setLocked(false)
    } catch (e) { setPinErr('Could not verify PIN'); setPinInput('') }
  }} />

  return <div className="app" style={{background:'#000',color:'#fff',minHeight:'100vh'}}>
    <div className="topbar">
      <div className="brand"><img src="./icon.png" alt="DiskDrive" onError={(e)=>{e.currentTarget.style.display='none'}}/><div><div className="name">DISKDRIVE</div></div></div>
      <div className="ver">DISKDRIVE V1</div>
    </div>

    {tab==='home' && <Home state={state} save={save} showToast={showToast} openPlayer={openPlayer} setTab={setTab} addDownload={addDownload} enqueueDownload={enqueueDownload} cancelDownload={cancelDownload} downloadJobs={downloadJobs} resolveState={resolveState} setResolveState={setResolveState} />}
    {tab==='download' && <Downloads state={state} save={save} showToast={showToast} openPlayer={openPlayer} setMenu={setMenu} setConfirm={setConfirm} downloadJobs={downloadJobs} enqueueDownload={enqueueDownload} cancelDownload={cancelDownload} removeDownloadJob={removeDownloadJob} clearDoneDownloads={clearDoneDownloads} />}
    {tab==='history' && <HistoryScreen state={state} save={save} showToast={showToast} openPlayer={openPlayer} setConfirm={setConfirm} />}
    {tab==='playlist' && <PlaylistScreen state={state} save={save} showToast={showToast} openPlayer={openPlayer} setMenu={setMenu} setConfirm={setConfirm} />}
    {tab==='settings' && <SettingsScreen state={state} save={save} showToast={showToast} onLock={()=>{ if(state.pinEnabled && state.pinHash) setLocked(true); else showToast('Enable PIN lock first') }} bundleStatus={bundleStatus} setBundleStatus={setBundleStatus} />}

    <nav className="bottom-nav"><div className="nav-inner">{TABS.map(t=>{ const Icon=t.icon; return <button key={t.id} className={`navbtn ${tab===t.id?'active':''}`} onClick={()=>setTab(t.id)}><Icon/><span>{t.label}</span></button> })}</div></nav>

    {playerItem && <Player item={playerItem} queue={playerQueue} onClose={()=>setPlayerItem(null)} onProgress={(src,pos,dur)=>updateHistoryPos(src,pos,dur)} onSelect={(it)=>{ setPlayerItem(it); updateHistoryPos(it.src, it.position||0, it.duration||0) }} showToast={showToast} enqueueDownload={enqueueDownload} cancelDownload={cancelDownload} downloadJobs={downloadJobs} teraboxCookie={state.settings?.teraboxCookie||''} downloadDir={state.settings?.downloadDir||'Download'} />}
    {menu && <MenuModal menu={menu} onClose={()=>setMenu(null)} />}
    {confirm && <ConfirmModal confirm={confirm} onClose={()=>setConfirm(null)} />}
    {toast && <div className="toast">{toast}</div>}
  </div>
}
