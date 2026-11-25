import React, { useState } from 'react'
import PinLock from '../components/PinLock.jsx'
import { sha256, verifyHash } from '../lib/hash.js'

export default function SettingsScreen({ state, save, showToast, onLock }) {
  const [serverStatus, setServerStatus] = useState(null)
  const [checking, setChecking] = useState(false)
  const [pinMode, setPinMode] = useState(null) // 'set' | 'change-old' | 'change-new'
  const [pin, setPin] = useState('')
  const [pinErr, setPinErr] = useState('')
  const [tempOldOk, setTempOldOk] = useState(false)

  const checkServer = async () => {
    setChecking(true)
    const url = state.settings?.serverUrl?.trim()
    if (!url) { setServerStatus({ ok:false, msg:'No server URL configured' }); setChecking(false); return }
    try {
      const r = await fetch(url, { method:'GET', cache:'no-store' })
      setServerStatus({ ok:r.ok, msg: r.ok ? `Connected (${r.status})` : `Error (${r.status})`, at: Date.now() })
    } catch (e) { setServerStatus({ ok:false, msg:'Not reachable', at: Date.now() }) }
    setChecking(false)
  }

  const enablePin = () => { setPin(''); setPinErr(''); setPinMode('set') }
  const changePin = () => { setPin(''); setPinErr(''); setTempOldOk(false); setPinMode('change-old') }
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
      setTempOldOk(true); setPinMode('change-new'); setPin(''); setPinErr('')
    }
  }

  return <div className="screen">
    <h1>Settings</h1>
    <p className="lead">Private testing controls for DiskDrive V1.</p>

    <div className="card">
      <div className="section-title">Account</div>
      <div className="item"><div className="meta"><div className="title">Testing Admin</div><div className="sub">Single admin account</div></div></div>
    </div>

    <div className="card">
      <div className="section-title">Backend status</div>
      <p className="small" style={{marginTop:0}}>Used for server-driven UI bundle and future sync. Plan 1 works locally without it.</p>
      <input className="input" placeholder="Server URL (optional for Plan 1)" value={state.settings?.serverUrl||''} onChange={e=>save({ settings:{...state.settings, serverUrl:e.target.value} })} />
      <div className="row" style={{marginTop:10}}>
        <button className="btn" onClick={checkServer} disabled={checking}>{checking?'Checking…':'Refresh status'}</button>
        {serverStatus && <span className="small">{serverStatus.ok?'●':'○'} {serverStatus.msg}{serverStatus.at?` • ${new Date(serverStatus.at).toLocaleTimeString()}`:''}</span>}
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
      <div className="item"><div className="meta"><div className="title">DISKDRIVE V1</div><div className="sub">Private Android testing build. Plan 1: local playback, UI, player, downloads, history, playlists.</div></div></div>
    </div>

    {pinMode && <PinLock mode={pinMode==='change-old'?'unlock':'set'} title={pinMode==='change-old'?'Enter current PIN':pinMode==='change-new'?'Enter new PIN':'Set 4-digit PIN'} pin={pin} setPin={setPin} err={pinErr} onDone={onPinDone} onCancel={()=>{setPinMode(null);setPin('');setPinErr('')}} />}
  </div>
}
