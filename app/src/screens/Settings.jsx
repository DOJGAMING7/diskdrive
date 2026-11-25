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

  const serverUrl = state.settings?.serverUrl?.trim() || ''
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
    if (!base) { setResolverStatus({ ok:false, msg:'Set Resolver URL first' }); return }
    setResolverChecking(true)
    try {
      const healthUrl = base.endsWith('/resolve') ? base.slice(0, -'/resolve'.length) + '/health' : base + '/health'
      const headers = {}
      const k = resolverKey.trim()
      if (k) headers['X-Resolver-Key'] = k
      const res = await fetch(healthUrl, { method:'GET', headers, cache:'no-store' })
      const data = await res.json().catch(()=>null)
      if (res.ok && (data?.ok || data?.service)) setResolverStatus({ ok:true, msg:`Connected (${res.status})` })
      else setResolverStatus({ ok:false, msg:`Error (${res.status})` })
    } catch (e) {
      setResolverStatus({ ok:false, msg:'Not reachable' })
    }
    setResolverChecking(false)
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
      <p className="small" style={{marginTop:0}}>Set a server URL to enable UI bundle updates. If server is down, app uses cached bundle or bundled UI.</p>
      <input className="input" placeholder="Server URL (https://...)" value={state.settings?.serverUrl||''} onChange={e=>save({ settings:{...state.settings, serverUrl:e.target.value} })} />
      <div className="row" style={{marginTop:10}}>
        <button className="btn" onClick={checkServer} disabled={checking}>{checking?'Checking…':'Check server'}</button>
        <button className="btn ghost" onClick={updateUi} disabled={updating}>{updating?'Updating…':'Update UI'}</button>
      </div>
      <div className="small" style={{marginTop:10}}>
        {serverStatus ? <div>{serverStatus.ok?'●':'○'} {serverStatus.msg}{serverStatus.at?` • ${new Date(serverStatus.at).toLocaleTimeString()}`:''}</div> : null}
        {bundleStatus?.meta ? <div style={{marginTop:6}}>UI version: {bundleStatus.meta.version || 'bundled'}{bundleStatus.meta.lastChecked ? ` • checked ${new Date(bundleStatus.meta.lastChecked).toLocaleString()}` : ''}</div> : null}
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
      <div className="section-title">Storage</div>
      <div className="item"><div className="meta"><div className="title">Local app data</div><div className="sub">History, playlists, downloads metadata stored on device.</div></div><button className="btn ghost" onClick={async()=>{ await save({ history:[], playlists: state.playlists.filter(p=>p.builtIn).map(p=>({...p,items:[]})), downloads:[] }); showToast('Local data cleared') }}>Clear</button></div>
    </div>

    <div className="card">
      <div className="section-title">About</div>
      <div className="item"><div className="meta"><div className="title">DISKDRIVE</div><div className="sub">Private Android testing build. Local playback, UI, player, downloads, history, playlists.</div></div></div>
    </div>

    {pinMode && <PinLock mode={pinMode==='change-old'?'unlock':'set'} title={pinMode==='change-old'?'Enter current PIN':pinMode==='change-new'?'Enter new PIN':'Set 4-digit PIN'} pin={pin} setPin={setPin} err={pinErr} onDone={onPinDone} onCancel={()=>{setPinMode(null);setPin('');setPinErr('')}} />}
  </div>
}
