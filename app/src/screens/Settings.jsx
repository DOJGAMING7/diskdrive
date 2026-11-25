import React, { useEffect, useState } from 'react'
import PinLock from '../components/PinLock.jsx'
import { sha256, verifyHash } from '../lib/hash.js'
import { checkAndUpdateBundle, getBundleMeta } from '../lib/updater.js'

export default function SettingsScreen({ state, save, showToast, onLock, bundleStatus, setBundleStatus }) {
  const [serverStatus, setServerStatus] = useState(null)
  const [checking, setChecking] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [teraboxStatus, setTeraboxStatus] = useState(null)
  const [teraboxChecking, setTeraboxChecking] = useState(false)
  const [teraboxSavedMsg, setTeraboxSavedMsg] = useState('')
  const [showNdus, setShowNdus] = useState(false)
  const [pinMode, setPinMode] = useState(null)
  const [pin, setPin] = useState('')
  const [pinErr, setPinErr] = useState('')
  const [clearStep, setClearStep] = useState(0)
  const [conn, setConn] = useState(null)
  const [connBusy, setConnBusy] = useState(false)
  const [latestUi, setLatestUi] = useState(null)
  const [uiCheckBusy, setUiCheckBusy] = useState(false)

  const serverUrl = state.settings?.serverUrl?.trim() || ''
  const serverLocked = !!state.settings?.serverLocked
  const teraboxCookie = state.settings?.teraboxCookie || ''
  const teraboxLocked = !!state.settings?.teraboxLocked
  const teraboxLog = Array.isArray(state.settings?.teraboxLog) ? state.settings.teraboxLog : [] 

  const checkUiUpdate = async () => {
    if (!serverUrl) { showToast('Set server URL first'); return }
    setUiCheckBusy(true)
    try {
      const r = await fetch(serverUrl.replace(/\/$/,'') + '/ui-manifest.json?t=' + Date.now(), { cache:'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const m = await r.json()
      setLatestUi({ version: m.version, notes: m.notes||[], date: m.date||'' })
      const cur = (await getBundleMeta())?.version || ''
      if (m.version && m.version !== cur) showToast(`Update available: ${m.version}`)
      else showToast(`UI up to date (${m.version || cur || 'bundled'})`)
    } catch (e) {
      showToast('Could not check update')
    }
    setUiCheckBusy(false)
  }

  useEffect(() => { checkUiUpdate() }, [serverUrl])

  const checkServer = async () => {
    setChecking(true)
    if (!serverUrl) { setServerStatus({ ok:false, msg:'No server URL configured', at:Date.now() }); setChecking(false); return }
    try {
      const r = await fetch(serverUrl.replace(/\/$/,'') + '/ui-manifest.json', { method:'GET', cache:'no-store' })
      setServerStatus({ ok:r.ok, msg: r.ok ? `Connected (${r.status})` : `Error (${r.status})`, at: Date.now() })
    } catch (e) { setServerStatus({ ok:false, msg:'Not reachable', at: Date.now() }) }
    setChecking(false)
  }

  const updateUi = async () => {
    if (!serverUrl) return showToast('Set server URL first')
    setUpdating(true)
    const res = await checkAndUpdateBundle(serverUrl)
    const meta = await getBundleMeta()
    setBundleStatus?.({ ...res, meta })
    const log = Array.isArray(state.settings?.updateLog) ? state.settings.updateLog : []
    const entry = { at: Date.now(), status: res.status, version: meta?.version || res.version || '', notes: res.notes || res.manifest?.notes || '' }
    await save({ settings: { ...state.settings, updateLog: [entry, ...log].slice(0, 30) } })
    setUpdating(false)
    if (res.status === 'updated') showToast('UI bundle updated. Restart app to load it.')
    else if (res.status === 'up-to-date') showToast('UI is up to date')
    else if (res.status === 'offline') showToast('Server unreachable. Cached/bundled UI will be used.')
    else showToast(`Update check: ${res.status}`)
  }

  const pushTeraboxLog = async (entry) => {
    const log = Array.isArray(state.settings?.teraboxLog) ? state.settings.teraboxLog : []
    await save({ settings: { ...state.settings, teraboxLog: [{ at: Date.now(), ...entry }, ...log].slice(0, 20) } })
  }

  const saveTerabox = async () => {
    const next = String(state.settings?.teraboxCookie || '').trim()
    const prev = String(state.settings?.teraboxCookie || '')
    await save({ settings: { ...state.settings, teraboxCookie: next, teraboxResolverMode: 'device', teraboxLocked: !!next } })
    setTeraboxSavedMsg(next ? 'Saved & locked on device' : 'Cleared')
    setTeraboxStatus(null)
    if (next !== prev) await pushTeraboxLog({ action: next ? 'saved' : 'cleared', ok: true, msg: next ? 'NDUS saved on device' : 'NDUS cleared' })
    showToast(next ? 'Terabox NDUS saved and locked' : 'Terabox NDUS cleared')
  }

  const clearTerabox = async () => {
    await save({ settings: { ...state.settings, teraboxCookie: '', teraboxLocked: false } })
    setTeraboxSavedMsg('Cleared')
    setTeraboxStatus(null)
    await pushTeraboxLog({ action: 'cleared', ok: true, msg: 'NDUS cleared (1-click)' })
    showToast('Terabox NDUS cleared from device')
  }

  const checkTerabox = async () => {
    const cookie = String(state.settings?.teraboxCookie || '').trim()
    if (!cookie) { const s={ ok:false, msg:'Add NDUS/cookie first' }; setTeraboxStatus(s); return s }
    setTeraboxChecking(true)
    setTeraboxStatus(null)
    try {
      const { resolveTeraboxLink } = await import('../lib/terabox.js')
      const testUrl = 'https://1024terabox.com/s/1dDWl5i567Ih1tlp6WWF60A'
      const r = await resolveTeraboxLink(testUrl, { teraboxCookie: cookie })
      const ok = !!(r?.directUrl || r?.src)
      const status = { ok, msg: ok ? `On-device resolve OK (${String(r?.name||'file').slice(0,40)})` : 'Resolved but no direct link' }
      setTeraboxStatus(status)
      await pushTeraboxLog({ action: 'test', ok, msg: status.msg })
      return status
    } catch (e) {
      const msg = String(e?.message || e)
      const status = { ok:false, msg: msg.slice(0,180) }
      setTeraboxStatus(status)
      await pushTeraboxLog({ action: 'test', ok: false, msg: msg.slice(0,180) })
      return status
    } finally {
      setTeraboxChecking(false)
    }
  }

  const checkConnectivity = async () => {
    setConnBusy(true)
    const out = {}
    const t0 = performance.now()
    try { const r = await fetch('https://api.cloudflare.com/cdn-cgi/trace', {cache:'no-store'}); out.cloudflare = { ok:r.ok, msg: r.ok?`OK ${Math.round(performance.now()-t0)}ms`:`${r.status}` } }
    catch { out.cloudflare = { ok:false, msg:'Unreachable' } }
    const tr = performance.now()
    try {
      const cookie = String(state.settings?.teraboxCookie || '').trim()
      if (!cookie) out.terabox = { ok:false, msg:'NDUS not set' }
      else {
        const { resolveTeraboxLink } = await import('../lib/terabox.js')
        const r = await resolveTeraboxLink('https://1024terabox.com/s/1dDWl5i567Ih1tlp6WWF60A', { teraboxCookie: cookie })
        out.terabox = { ok: !!(r?.directUrl||r?.src), msg: `OK ${Math.round(performance.now()-tr)}ms` }
      }
    } catch (e) { out.terabox = { ok:false, msg: `Failed ${Math.round(performance.now()-tr)}ms` } }
    const tu = performance.now()
    try { const r = await fetch(serverUrl.replace(/\/$/,'') + '/ui-manifest.json', {cache:'no-store'}); out.ui = { ok:r.ok, msg: r.ok?`OK ${Math.round(performance.now()-tu)}ms`:`${r.status}` } }
    catch { out.ui = { ok:false, msg: serverUrl ? 'Unreachable' : 'Not set' } }
    setConn(out); setConnBusy(false)
  }

  const exportBackup = async () => {
    try {
      const safeSettings = { ...(state.settings||{}) }; delete safeSettings.teraboxCookie; delete safeSettings.teraboxLocked; delete safeSettings.teraboxLog; delete safeSettings.resolverUrl; delete safeSettings.resolverKey; delete safeSettings.resolverLocked;
      const data = { v:1, exportedAt:new Date().toISOString(), state: { history: state.history||[], playlists: state.playlists||[], downloads: state.downloads||[], settings: safeSettings } }
      const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'})
      const a = document.createElement('a'); const url = URL.createObjectURL(blob)
      a.href=url; a.download=`diskdrive-backup-${Date.now()}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(url), 5000)
      showToast('Backup exported')
    } catch { showToast('Backup export failed') }
  }

  const importBackup = async (e) => {
    const f = e.target.files?.[0]; e.target.value=''
    if (!f) return
    try {
      const data = JSON.parse(await f.text())
      const st = data?.state || data
      const importedSettings = { ...(st.settings || {}) }
      // Never import secrets/legacy resolver credentials from backups
      delete importedSettings.teraboxCookie
      delete importedSettings.teraboxLocked
      delete importedSettings.teraboxLog
      delete importedSettings.resolverUrl
      delete importedSettings.resolverKey
      delete importedSettings.resolverLocked
      await save({
        history: Array.isArray(st.history)?st.history:[],
        playlists: Array.isArray(st.playlists)?st.playlists:state.playlists,
        downloads: Array.isArray(st.downloads)?st.downloads:[],
        settings: { ...state.settings, ...importedSettings },
      })
      showToast('Backup restored (NDUS/secrets not imported)')
    } catch { showToast('Invalid backup file') }
  }

  const enablePin = () => { setPin(''); setPinErr(''); setPinMode('set') }
  const changePin = () => { setPin(''); setPinErr(''); setPinMode('change-old') }
  const disablePin = async () => { await save({ pinEnabled:false, pinHash:null }); showToast('PIN lock disabled') }

  const onPinDone = async (value) => {
    if (pinMode==='set' || pinMode==='change-new') {
      const hash = await sha256(value)
      await save({ pinHash: hash, pinEnabled: true })
      setPinMode(null); setPin(''); setPinErr(''); showToast('PIN saved')
      return
    }
    if (pinMode==='change-old') {
      const ok = await verifyHash(value, state.pinHash)
      if (!ok) { setPinErr('Wrong PIN'); setPin(''); return }
      setPinMode('change-new'); setPin(''); setPinErr('')
    }
  }

  return <div className="screen">
    <h1>Settings</h1>
    <p className="lead">Private testing controls for DiskDrive.</p>

    <div className="card">
      <div className="section-title">Account</div>
      <div className="item"><div className="meta"><div className="title">Testing Admin</div><div className="sub">Single admin account</div></div></div>
    </div>

    <div className="card">
      <div className="section-title">Backend / UI updates</div>
      <p className="small" style={{marginTop:0}}>Server URL is used for OTA UI updates. Lock it to avoid accidental deletion.</p>
      <input className="input" placeholder="Server URL (https://...)" value={state.settings?.serverUrl||''} disabled={serverLocked} onChange={e=>save({ settings:{...state.settings, serverUrl:e.target.value} })} />
      <div className="row" style={{marginTop:10}}>
        {!serverLocked ? <button className="btn ghost" onClick={()=>save({ settings:{...state.settings, serverLocked:true } })}>Lock URL</button> : <button className="btn ghost" onClick={()=>save({ settings:{...state.settings, serverLocked:false } })}>Unlock URL</button>}
        <button className="btn" onClick={checkServer} disabled={checking}>{checking?'Checking…':'Check server'}</button>
        <button className="btn ghost" onClick={checkUiUpdate} disabled={uiCheckBusy}>{uiCheckBusy?'Checking…':'Check update'}</button>
        <button className="btn ghost" onClick={updateUi} disabled={updating}>{updating?'Updating…':'Update UI'}</button>
      </div>
      <div className="small" style={{marginTop:10}}>
        <div>{serverLocked ? '🔒 URL locked' : '🔓 URL unlocked'}</div>
        {serverStatus ? <div>{serverStatus.ok?'●':'○'} {serverStatus.msg}{serverStatus.at?` • ${new Date(serverStatus.at).toLocaleTimeString()}`:''}</div> : null}
        {bundleStatus?.meta ? <div style={{marginTop:6}}>UI version: {bundleStatus.meta.version || 'bundled'}{bundleStatus.meta.lastChecked ? ` • checked ${new Date(bundleStatus.meta.lastChecked).toLocaleString()}` : ''}</div> : null}
        {latestUi?.version && latestUi.version !== bundleStatus?.meta?.version ? <div style={{marginTop:6,color:'#7dd3fc'}}>Update available: {latestUi.version}{latestUi.date?` • ${latestUi.date}`:''}</div> : latestUi?.version ? <div style={{marginTop:6,color:'#86efac'}}>You are on latest UI ({latestUi.version})</div> : null}
        {bundleStatus?.manifest?.notes?.length ? <div style={{marginTop:8}}><div style={{fontWeight:600,color:'#fff'}}>What’s new:</div>{bundleStatus.manifest.notes.map((n,i)=><div key={i}>• {n}</div>)}</div> : null}
        {bundleStatus?.manifest?.history?.length ? <details style={{marginTop:8}}><summary style={{cursor:'pointer'}}>Update history</summary>{bundleStatus.manifest.history.map((h,i)=><div key={i} style={{marginTop:6}}><div style={{color:'#fff'}}>{h.version} {h.date?`• ${h.date}`:''}</div>{(h.notes||[]).map((n,j)=><div key={j}>- {n}</div>)}</div>)}</details> : null}
      </div>
    </div>

    <div className="card">
      <div className="section-title">Terabox (Private, on-device)</div>
      <p className="small" style={{marginTop:0}}>Uses your Terabox NDUS/cookie on this device only to resolve direct links. It is never committed, never sent to OTA, and never included in backup export.</p>
      <div style={{display:'grid',gap:8}}>
        <div style={{display:'flex',gap:8}}>
          <input className="input" value={teraboxCookie} disabled={teraboxLocked} onChange={e=>{ setTeraboxSavedMsg(''); save({ settings:{ ...state.settings, teraboxCookie:e.target.value } }) }} placeholder="NDUS or full cookie (device-only)" type={showNdus?'text':'password'} autoCapitalize="off" autoCorrect="off" spellCheck="false" />
          <button className="btn ghost" onClick={()=>setShowNdus(v=>!v)}>{showNdus?'Hide':'Show'}</button>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {!teraboxLocked ? <button className="btn primary" onClick={saveTerabox}>Save & Lock</button> : <button className="btn ghost" onClick={()=>save({ settings:{ ...state.settings, teraboxLocked:false } })}>Unlock</button>}
          <button className="btn ghost" onClick={checkTerabox} disabled={teraboxChecking}>{teraboxChecking ? 'Testing…' : 'Test resolve'}</button>
          <button className="btn ghost" onClick={clearTerabox}>Clear (1-click)</button>
        </div>
        <div className="small" style={{marginTop:2}}>{teraboxLocked ? '🔒 Locked' : '🔓 Unlocked'}{teraboxSavedMsg ? ` • ${teraboxSavedMsg}` : ''}</div>
        {teraboxStatus && <div className="small" style={{color:teraboxStatus.ok?'#7fdca3':'#ff9b9b'}}>{teraboxStatus.msg}</div>}
        <div className="small" style={{opacity:.7}}>Tip: paste just the NDUS value, or a full cookie containing ndus=…</div>
        {teraboxLog.length > 0 && <details style={{marginTop:8}}><summary className="small" style={{cursor:'pointer'}}>NDUS history ({teraboxLog.length})</summary><div style={{marginTop:6,display:'grid',gap:6}}>{teraboxLog.map((l,i)=><div key={i} className="small" style={{opacity:.85}}><span style={{color:l.ok?'#7fdca3':'#ff9b9b'}}>{l.ok?'●':'○'}</span> {new Date(l.at).toLocaleString()} • {l.action} • {String(l.msg||'').slice(0,120)}</div>)}<button className="btn ghost" onClick={()=>save({ settings:{ ...state.settings, teraboxLog: [] } })}>Clear history</button></div></details>}
      </div>
    </div>

    <div className="card">
      <div className="section-title">App lock</div>
      <div className="list">
        <div className="item"><div className="meta"><div className="title">PIN lock</div><div className="sub">{state.pinEnabled?'Enabled':'Disabled'} • No forgot PIN</div></div><button className="btn ghost" onClick={state.pinEnabled?disablePin:enablePin}>{state.pinEnabled?'Disable':'Enable'}</button></div>
        {state.pinEnabled && <div className="item"><div className="meta"><div className="title">Change PIN</div><div className="sub">Requires current PIN</div></div><button className="btn ghost" onClick={changePin}>Change</button></div>}
        <div className="item"><div className="meta"><div className="title">Lock delay</div><div className="sub">Lock after leaving app</div></div>
          <select className="input" style={{width:140}} value={state.lockDelay||15} onChange={e=>save({ lockDelay:Number(e.target.value) })}>
            {[5,15,30,60].map(s=><option key={s} value={s}>{s}s</option>)}
          </select>
        </div>
        <div className="item"><div className="meta"><div className="title">Lock now</div><div className="sub">Test PIN lock</div></div><button className="btn ghost" onClick={onLock}>Lock</button></div>
      </div>
    </div>

    <div className="card">
      <div className="section-title">Downloads / Storage</div>
      <div className="item" style={{flexDirection:'column',alignItems:'stretch',gap:8}}>
        <div className="meta"><div className="title">Download storage</div><div className="sub">In-app storage counts toward app data and plays offline reliably. Device folder exports to shared Download/Documents for file manager access.</div></div>
        <select className="input" value={state.settings?.downloadStorage||'inapp'} onChange={e=>save({ settings:{...state.settings, downloadStorage:e.target.value} })}>
          <option value="inapp">In-app storage (recommended)</option>
          <option value="device">Device Download/Documents folder</option>
        </select>
      </div>
      <div className="item" style={{flexDirection:'column',alignItems:'stretch',gap:8}}>
        <div className="meta"><div className="title">Download folder name</div><div className="sub">{(state.settings?.downloadStorage||'inapp')==='device' ? 'Saved in device Download/Documents folder.' : 'Saved inside app private storage (counts in app data).'}</div></div>
        <div className="row" style={{gap:8}}>
          <input className="input" style={{flex:1}} value={state.settings?.downloadDir||'Download'} onChange={e=>save({ settings:{...state.settings, downloadDir:e.target.value} })} placeholder="Download" />
          <button className="btn" onClick={()=>{ save({ settings:{...state.settings, downloadDir: (state.settings?.downloadDir||'Download').trim() || 'Download' } }); showToast('Download folder saved') }}>Save</button>
        </div>
      </div>
      <div className="item"><div className="meta"><div className="title">Current download target</div><div className="sub">{(state.settings?.downloadStorage||'inapp')==='device' ? `Device shared folder: Download/${(state.settings?.downloadDir||'Download').trim()||'Download'}` : `In-app private: downloads/${(state.settings?.downloadDir||'Download').trim()||'Download'}`}</div></div></div>
      <div className="item"><div className="meta"><div className="title">Local app data</div><div className="sub">History, playlists, downloads metadata stored on device.</div></div>
        <button className="btn ghost" onClick={async()=>{
          if (clearStep===0) { setClearStep(1); showToast('Tap Clear again to confirm'); setTimeout(()=>setClearStep(0), 4000); return }
          if (clearStep===1) { setClearStep(2); showToast('Final confirm: tap Clear once more'); setTimeout(()=>setClearStep(0), 4000); return }
          await save({ history:[], playlists: (state.playlists||[]).filter(p=>p.builtIn).map(p=>({...p,items:[]})), downloads:[] }); setClearStep(0); showToast('Local data cleared')
        }}>{clearStep===0?'Clear':clearStep===1?'Confirm':'Final clear'}</button>
      </div>
      <div className="item"><div className="meta"><div className="title">Backup</div><div className="sub">Export/restore history, playlists, downloads metadata, settings.</div></div>
        <div className="row" style={{gap:8}}>
          <button className="btn ghost" onClick={exportBackup}>Export</button>
          <label className="btn ghost" style={{cursor:'pointer'}}>Restore<input type="file" accept="application/json" hidden onChange={importBackup}/></label>
        </div>
      </div>
    </div>

    <div className="card">
      <div className="section-title">Connectivity check</div>
      <p className="small" style={{marginTop:0}}>Check Cloudflare, on-device Terabox resolver, and UI server response.</p>
      <button className="btn ghost" onClick={checkConnectivity} disabled={connBusy}>{connBusy?'Checking…':'Check all connections'}</button>
      {conn && <div className="small" style={{marginTop:10}}>
        <div>{conn.cloudflare?.ok?'●':'○'} Cloudflare: {conn.cloudflare?.msg}</div>
        <div>{conn.terabox?.ok?'●':'○'} Terabox resolver: {conn.terabox?.msg}</div>
        <div>{conn.ui?.ok?'●':'○'} UI Server: {conn.ui?.msg}</div>
      </div>}
    </div>

    <div className="card">
      <div className="section-title">App controls</div>
      <div className="item"><div className="meta"><div className="title">Restart app</div><div className="sub">Reloads UI bundle and app state. Useful after UI update.</div></div><button className="btn ghost" onClick={()=>{ try { sessionStorage.clear() } catch {} window.location.reload() }}>Restart</button></div>
    </div>

    <div className="card">
      <div className="section-title">About</div>
      <div className="item"><div className="meta"><div className="title">DISKDRIVE</div><div className="sub">Private Android testing build. Local playback, UI, player, downloads, history, playlists.</div></div></div>
    </div>

    {pinMode && <PinLock mode={pinMode==='change-old'?'unlock':'set'} title={pinMode==='change-old'?'Enter current PIN':pinMode==='change-new'?'Enter new PIN':'Set 4-digit PIN'} pin={pin} setPin={setPin} err={pinErr} onDone={onPinDone} onCancel={()=>{setPinMode(null);setPin('');setPinErr('')}} />}
  </div>
}
