import React, { useEffect, useRef, useState } from 'react'
import { I } from './components/Icons.jsx'
import { loadState, persist } from './lib/store.js'
import { sha256, verifyHash } from './lib/hash.js'
import { uid, now } from './lib/id.js'
import { initNative, onAppState } from './lib/native.js'
import { checkAndUpdateBundle, getBundleMeta, getCachedBundleUrl } from './lib/updater.js'
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

const ADMIN_PASSWORD = 'XBOXS@7860'
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
  const [state, setState] = useState(null)
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
  const lockTimer = useRef(null)
  const lastActive = useRef(Date.now())

  useEffect(() => { initNative() }, [])
  useEffect(() => { (async () => {
    const s = await loadState()
    const serverUrl = s?.settings?.serverUrl || ''
    if (serverUrl) {
      setBootMsg('Checking for UI updates…')
      const res = await checkAndUpdateBundle(serverUrl)
      const meta = await getBundleMeta()
      setBundleStatus({ ...res, meta })
      const cachedUrl = await getCachedBundleUrl()
      const params = new URLSearchParams(location.search)
      const allowCached = !params.has('bundled')
      const alreadyCached = sessionStorage.getItem('dd_using_cached_bundle') === '1'
      if (cachedUrl && allowCached && !alreadyCached && (res.status === 'updated' || res.status === 'up-to-date' || res.status === 'offline')) {
        sessionStorage.setItem('dd_using_cached_bundle', '1')
        location.replace(cachedUrl + (cachedUrl.includes('?') ? '&' : '?') + 'cached=1')
        return
      }
    } else {
      setBundleStatus({ status:'no-server', meta: await getBundleMeta() })
    }
    setState(s)
    setReady(true)
    if (s.adminUnlocked && s.pinEnabled && s.pinHash) setLocked(true)
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
      const next = { ...prev, ...patch }
      for (const k of Object.keys(patch)) if (persist[k]) persist[k](patch[k])
      return next
    })
  }
  const showToast = (msg) => setToast(msg)

  const openPlayer = (item, queue=[]) => {
    const q = queue.length ? queue : [item]
    setPlayerQueue(q)
    setPlayerItem(item)
    setState(prev => {
      const existing = (prev.history||[]).find(h => h.src && h.src === item.src)
      const entry = { id: existing?.id || uid(), mediaId: item.id, provider: item.provider || 'LOCAL', title: item.title || item.name, name: item.name, src: item.src, kind: item.kind||'local', watchedAt: now(), position: existing?.position || item.position || 0, duration: existing?.duration || item.duration || 0, watchCount: (existing?.watchCount || 0) + 1 }
      const history = [entry, ...(prev.history||[]).filter(h => !(h.src && h.src===item.src))].slice(0,200)
      persist.history(history)
      return { ...prev, history }
    })
  }
  const updateHistoryPos = (src, position, duration) => {
    if (!src) return
    setState(prev => {
      const history = (prev.history||[]).map(h => h.src===src ? { ...h, position, duration: duration||h.duration, watchedAt: now() } : h)
      persist.history(history)
      return { ...prev, history }
    })
  }

  if (!ready || !state) return <div className="overlay"><div className="panel"><h2>DISKDRIVE</h2><p>{bootMsg}</p></div></div>

  if (!state.adminUnlocked) return <AdminGate input={adminInput} setInput={setAdminInput} err={adminErr} attempts={adminAttempts} waitUntil={adminWaitUntil} onSubmit={async ()=>{
    if (Date.now() < adminWaitUntil) return
    const ok = adminInput === ADMIN_PASSWORD
    if (!ok) { const n=adminAttempts+1; setAdminAttempts(n); setAdminErr('Invalid password'); if (n>=5) { setAdminWaitUntil(Date.now()+30000); setAdminErr('Too many attempts. Wait 30 seconds.') } return }
    const hash = await sha256(ADMIN_PASSWORD)
    await save({ adminUnlocked: true, adminHash: hash })
    setAdminErr('')
  }} />

  if (locked && state.pinEnabled && state.pinHash) return <PinLock mode="unlock" pin={pinInput} setPin={setPinInput} err={pinErr} onBack={()=>{}} onDone={async (pin)=>{
    const ok = await verifyHash(pin, state.pinHash)
    if (!ok) { setPinErr('Wrong PIN'); setPinInput(''); return }
    setPinErr(''); setPinInput(''); setLocked(false)
  }} />

  return <div className="app">
    <div className="topbar">
      <div className="brand"><img src="./icon.png" alt="DiskDrive" onError={(e)=>{e.currentTarget.style.display='none'}}/><div><div className="name">DISKDRIVE</div><div className="small">Private testing build</div></div></div>
      <div className="ver">DISKDRIVE</div>
    </div>

    {tab==='home' && <Home state={state} save={save} showToast={showToast} openPlayer={openPlayer} setTab={setTab} />}
    {tab==='download' && <Downloads state={state} save={save} showToast={showToast} openPlayer={openPlayer} setMenu={setMenu} setConfirm={setConfirm} />}
    {tab==='history' && <HistoryScreen state={state} save={save} showToast={showToast} openPlayer={openPlayer} setConfirm={setConfirm} />}
    {tab==='playlist' && <PlaylistScreen state={state} save={save} showToast={showToast} openPlayer={openPlayer} setMenu={setMenu} setConfirm={setConfirm} />}
    {tab==='settings' && <SettingsScreen state={state} save={save} showToast={showToast} onLock={()=>{ if(state.pinEnabled && state.pinHash) setLocked(true); else showToast('Enable PIN lock first') }} bundleStatus={bundleStatus} setBundleStatus={setBundleStatus} />}

    <nav className="bottom-nav"><div className="nav-inner">{TABS.map(t=>{ const Icon=t.icon; return <button key={t.id} className={`navbtn ${tab===t.id?'active':''}`} onClick={()=>setTab(t.id)}><Icon/><span>{t.label}</span></button> })}</div></nav>

    {playerItem && <Player item={playerItem} queue={playerQueue} onClose={()=>setPlayerItem(null)} onProgress={(src,pos,dur)=>updateHistoryPos(src,pos,dur)} onSelect={(it)=>{ setPlayerItem(it); updateHistoryPos(it.src, it.position||0, it.duration||0) }} />}
    {menu && <MenuModal menu={menu} onClose={()=>setMenu(null)} />}
    {confirm && <ConfirmModal confirm={confirm} onClose={()=>setConfirm(null)} />}
    {toast && <div className="toast">{toast}</div>}
  </div>
}
