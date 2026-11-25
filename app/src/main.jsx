import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles/app.css'

function Fatal({ error }) {
  return (
    <div style={{minHeight:'100vh',background:'#000',color:'#fff',padding:24,fontFamily:'system-ui,Arial',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{maxWidth:520,width:'100%'}}>
        <div style={{fontSize:28,fontWeight:800,letterSpacing:2,marginBottom:12}}>DISKDRIVE</div>
        <div style={{color:'#bbb',marginBottom:16}}>Something went wrong during startup.</div>
        <pre style={{whiteSpace:'pre-wrap',background:'#111',border:'1px solid #333',padding:12,borderRadius:12,fontSize:12,maxHeight:'40vh',overflow:'auto'}}>{String(error?.stack || error?.message || error)}</pre>
        <button onClick={() => location.reload()} style={{marginTop:16,background:'#fff',color:'#000',border:0,padding:'12px 16px',borderRadius:12,fontWeight:700}}>Reload</button>
      </div>
    </div>
  )
}

const root = createRoot(document.getElementById('root'))
try {
  root.render(<App />)
  window.__diskdriveMounted = true
  const boot = document.getElementById('boot-msg')
  if (boot) boot.textContent = 'Starting…'
} catch (e) {
  console.error(e)
  window.__diskdriveShowError?.(e?.stack || e?.message || String(e))
  root.render(<Fatal error={e} />)
}
