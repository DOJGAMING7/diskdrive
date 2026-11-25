import React, { useEffect, useState } from 'react'
export default function AdminGate({ input, setInput, err, attempts, waitUntil, onSubmit }) {
  const [nowTs, setNowTs] = useState(Date.now())
  useEffect(()=>{ const t=setInterval(()=>setNowTs(Date.now()),500); return ()=>clearInterval(t) },[])
  const waiting = nowTs < waitUntil
  const secs = Math.max(0, Math.ceil((waitUntil-nowTs)/1000))
  return <div className="overlay"><div className="panel">
    <div className="small" style={{letterSpacing:1.5,fontWeight:700,marginBottom:10}}>DISKDRIVE V1</div>
    <h2>Admin Access</h2>
    <p>This is a private testing build. Enter the admin password to continue.</p>
    <input className="input" type="password" value={input} onChange={e=>setInput(e.target.value)} placeholder="Admin password" autoFocus onKeyDown={e=>e.key==='Enter'&&onSubmit()} />
    {err && <div style={{color:'#fff',marginTop:10,fontSize:13}}>{err}{waiting?` (${secs}s)`:''}</div>}
    <div style={{marginTop:14}}><button className="btn block" onClick={onSubmit} disabled={waiting}>Unlock</button></div>
  </div></div>
}
