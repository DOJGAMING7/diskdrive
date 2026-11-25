import React from 'react'
export default function PinLock({ mode='unlock', pin, setPin, err, onDone, onCancel, title }) {
  const push = (d) => { if (pin.length>=4) return; const n = pin + d; setPin(n); if (n.length===4) setTimeout(()=>onDone(n), 120) }
  const back = () => setPin(pin.slice(0,-1))
  return <div className="overlay"><div className="panel" style={{textAlign:'center'}}>
    <div className="small" style={{letterSpacing:1.5,fontWeight:700,marginBottom:10}}>DISKDRIVE</div>
    <h2 style={{fontSize:24}}>{title || (mode==='set'?'Set 4-digit PIN':'Enter PIN')}</h2>
    <p>{mode==='set'?'This PIN locks the app when you leave it. No forgot PIN.':'App is locked.'}</p>
    <div className="pin-dots">{[0,1,2,3].map(i=><span key={i} className={i<pin.length?'on':''}/>)}</div>
    {err && <div style={{marginBottom:12,fontSize:13}}>{err}</div>}
    <div className="keypad">{['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k,i)=> k===''? <div key={i}/>: <button key={i} onClick={()=>k==='⌫'?back():push(k)}>{k}</button>)}</div>
    {onCancel && <div style={{marginTop:12}}><button className="btn ghost block" onClick={onCancel}>Cancel</button></div>}
  </div></div>
}
