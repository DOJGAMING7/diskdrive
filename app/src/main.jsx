import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles/app.css'

function Fatal({ error }) {
  const msg = String(error?.stack || error?.message || error || 'Unknown error')
  return (
    <div style={{minHeight:'100vh',background:'#000',color:'#fff',padding:24,fontFamily:'system-ui,Arial',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{maxWidth:560,width:'100%'}}>
        <div style={{fontSize:28,fontWeight:800,letterSpacing:2,marginBottom:12}}>DISKDRIVE</div>
        <div style={{color:'#bbb',marginBottom:16}}>Startup error. Screenshot this and share it.</div>
        <pre style={{whiteSpace:'pre-wrap',wordBreak:'break-word',background:'#111',border:'1px solid #333',padding:12,borderRadius:12,fontSize:12,maxHeight:'45vh',overflow:'auto'}}>{msg}</pre>
        <button onClick={() => location.reload()} style={{marginTop:16,background:'#fff',color:'#000',border:0,padding:'12px 16px',borderRadius:12,fontWeight:700}}>Reload</button>
      </div>
    </div>
  )
}

window.__diskdriveBootStatus = (msg) => {
  try {
    const el = document.getElementById('boot-msg')
    if (el) el.textContent = String(msg)
    console.log('[DiskDrive boot]', msg)
  } catch {}
}

const rootEl = document.getElementById('root')
const root = createRoot(rootEl)
try {
  root.render(<App />)
} catch (e) {
  console.error(e)
  window.__diskdriveShowError?.(e?.stack || e?.message || String(e))
  try { root.render(<Fatal error={e} />) } catch {}
}
