import React, { useState } from 'react'
import PinLock from '../components/PinLock.jsx'
import { sha256, verifyHash } from '../lib/hash.js'
import { checkAndUpdateBundle, getBundleMeta } from '../lib/updater.js'

export default function SettingsScreen({ state, save, showToast, onLock, bundleStatus, setBundleStatus }) {
  const [serverStatus, setServerStatus] = useState(null)
  const [checking, setChecking] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [resolverStatus, setResolverStatus] = useState(null)
  const [resolverChecking, setResolverChecking] = useState(false)
  const [resolverSavedMsg, setResolverSavedMsg] = useState('')
  const [pinMode, setPinMode] = useState(null)
  const [pin, setPin] = useState('')
  const [pinErr, setPinErr] = useState('')
  const [clearStep, setClearStep] = useState(0)
  const [conn, setConn] = useState(null)
  const [connBusy, setConnBusy] = useState(false)

  const serverUrl = state.settings?.serverUrl?.trim() || ''
  const serverLocked = !!state.settings?.serverLocked
  const resolverLocked = !!state.settings?.resolverLocked
  const resolverUrl = state.settings?.resolverUrl || ''
  const resolverKey = state.settings?.resolverKey || ''

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

  const saveResolver = async () => {
    await save({ settings: { ...state.settings, resolverUrl: resolverUrl.trim(), resolverKey: resolverKey.trim(), resolverLocked: true } })
    setResolverSavedMsg('Saved and locked')
    setResolverStatus(null)
    showToast('Resolver settings saved and locked')
  }

  const checkResolver = async () => {
    const base = resolverUrl.trim().replace(/\/+$/, '')
    if (!base) { setResolverStatus({ ok:false, msg:'Set Resolver URL first' }); return null }
    setResolverChecking(true)
    const t0 = performance.now()
    try {
      const healthUrl = base.endsWith('/resolve') ? base.slice(0, -'/resolve'.length) + '/health' : base + '/health'
      const headers = {}
      const k = resolverKey.trim()
      if (k) headers['X-Resolver-Key'] = k
      const res = await fetch(healthUrl, { method:'GET', headers, cache:'no-store' })
      const data = await res.json().catch(()=>null)
      const ms = Math.round(performance.now()-t0)
      const ok = res.ok && (data?.ok || data?.service)
      const out = { ok, msg:`${ok?'Connected':'Error'} (${res.status}) • ${ms}ms`, ms }
      setResolverStatus(out)
      setResolverChecking(false)
      return out
    } catch (e) {
      const out = { ok:false, msg:`Not reachable • ${Math.round(performance.now()-t0)}ms` }
      setResolverStatus(out)
      setResolverChecking(false)
      return out
    }
  }

  const checkConnectivity = async () => {
    setConnBusy(true)
    const out = {}
    const t0 = performance.now()
    try { const r = await fetch('https://api.cloudflare.com/cdn-cgi/trace', {cache:'no-store'}); out.cloudflare = { ok:r.ok, msg: r.ok?`OK ${Math.round(performance.now()-t0)}ms`:`${r.status}` } }
    catch { out.cloudflare = { ok:false, msg:'Unreachable' } }
    const tr = performance.now()
    out.render = await (async()=>{ try {
      const base = resolverUrl.trim().replace(/\/+$/, '')
      if (!base) return { ok:false, msg:'Resolver URL not set' }
      const healthUrl = base.endsWith('/resolve') ? base.slice(0,-'/resolve'.length)+'/health' : base+'/health'
      const headers = {}; const k=resolverKey.trim(); if(k) headers['X-Resolver-Key']=k
      const r = await fetch(healthUrl, {headers, cache:'no-store'})
      const d = await r.json().catch(()=>null)
      return { ok:r.ok && (d?.ok||d?.service), msg:`${r.ok?'OK':'Err'} ${Math.round(performance.now()-tr)}ms` }
    } catch { return { ok:false, msg:`Unreachable ${Math.round(performance.now()-tr)}ms` } } })()
    const tu = performance.now()
    try { const r = await fetch(serverUrl.replace(/\/$/,'') + '/ui-manifest.json', {cache:'no-store'}); out.ui = { ok:r.ok, msg: r.ok?`OK ${Math.round(performance.now()-tu)}ms`:`${r.status}` } }
    catch { out.ui = { ok:false, msg: serverUrl ? 'Unreachable' : 'Not set' } }
    setConn(out); setConnBusy(false)
  }

  const exportBackup = async () => {
    try {
      const data = { v:1, exportedAt:new Date().toISOString(), state: { history: state.history||[], playlists: state.playlists||[], downloads: state.downloads||[], settings: state.settings||{} } }
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
      await save({
        history: Array.isArray(st.history)?st.history:[],
        playlists: Array.isArray(st.playlists)?st.playlists:state.playlists,
        downloads: Array.isArray(st.downloads)?st.downloads:[],
        settings: { ...state.settings, ...(st.settings||{}) },
      })
      showToast('Backup restored')
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
        <button className="btn ghost" onClick={updateUi} disabled={updating}>{updating?'Updating…':'Update UI'}</button>
      </div>
      <div className="small" style={{marginTop:10}}>
        <div>{serverLocked ? '🔒 URL locked' : '🔓 URL unlocked'}</div>
        {serverStatus ? <div>{serverStatus.ok?'●':'○'} {serverStatus.msg}{serverStatus.at?` • ${new Date(serverStatus.at).toLocaleTimeString()}`:''}</div> : null}
        {bundleStatus?.meta ? <div style={{marginTop:6}}>UI version: {bundleStatus.meta.version || 'bundled'}{bundleStatus.meta.lastChecked ? ` • checked ${new Date(bundleStatus.meta.lastChecked).toLocaleString()}` : ''}</div> : null}
        {bundleStatus?.manifest?.notes?.length ? <div style={{marginTop:8}}><div style={{fontWeight:600,color:'#fff'}}>What’s new:</div>{bundleStatus.manifest.notes.map((n,i)=><div key={i}>• {n}</div>)}</div> : null}
        {bundleStatus?.manifest?.history?.length ? <details style={{marginTop:8}}><summary style={{cursor:'pointer'}}>Update history</summary>{bundleStatus.manifest.history.map((h,i)=><div key={i} style={{marginTop:6}}><div style={{color:'#fff'}}>{h.version} {h.date?`• ${h.date}`:''}</div>{(h.notes||[]).map((n,j)=><div key={j}>- {n}</div>)}</div>)}</details> : null}
      </div>
    </div>

    <div className="card">
      <div className="section-title">Terabox resolver</div>
      <p className="small" style={{marginTop:0}}>Set your resolver Worker URL. NDUS stays on the server secret, never in this app. Lock prevents accidental edits.</p>
      <input className="input" placeholder="Resolver URL (https://.../resolve)" value={resolverUrl} disabled={resolverLocked} onChange={e=>{ setResolverSavedMsg(''); save({ settings:{...state.settings, resolverUrl:e.target.value} }) }} />
      <input className="input" style={{marginTop:10}} placeholder="Resolver key (optional)" value={resolverKey} disabled={resolverLocked} onChange={e=>{ setResolverSavedMsg(''); save({ settings:{...state.settings, resolverKey:e.target.value} }) }} />
      <div className="row" style={{marginTop:10}}>
        {!resolverLocked ? <button className="btn" onClick={saveResolver}>Save & Lock</button> : <button className="btn ghost" onClick={()=>{ save({ settings:{...state.settings, resolverLocked:false} }); setResolverSavedMsg('Unlocked for editing') }}>Unlock</button>}
        <button className="btn ghost" onClick={checkResolver} disabled={resolverChecking}>{resolverChecking?'Checking…':'Check resolver'}</button>
      </div>
      <div className="small" style={{marginTop:10}}>
        <div>{resolverLocked ? '🔒 Locked' : '🔓 Unlocked' }{resolverSavedMsg ? ` • ${resolverSavedMsg}` : ''}</div>
        {resolverStatus ? <div style={{marginTop:6}}>{resolverStatus.ok?'●':'○'} {resolverStatus.msg}</div> : null}
        <div style={{marginTop:6}}>DiskWala resolve is still coming soon.</div>
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
        <div className="meta"><div className="title">Download folder name</div><div className="sub">Saved in device Download folder (native). Example: Download/DiskDrive</div></div>
        <input className="input" value={state.settings?.downloadDir||'Download'} onChange={e=>save({ settings:{...state.settings, downloadDir:e.target.value} })} placeholder="Download" />
      </div>
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
      <p className="small" style={{marginTop:0}}>Check Cloudflare, Render resolver, and UI server response.</p>
      <button className="btn ghost" onClick={checkConnectivity} disabled={connBusy}>{connBusy?'Checking…':'Check all connections'}</button>
      {conn && <div className="small" style={{marginTop:10}}>
        <div>{conn.cloudflare?.ok?'●':'○'} Cloudflare: {conn.cloudflare?.msg}</div>
        <div>{conn.render?.ok?'●':'○'} Render/Resolver: {conn.render?.msg}</div>
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
