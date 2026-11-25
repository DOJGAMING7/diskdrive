import React from 'react'
export default function MenuModal({ menu, onClose }) {
  if (!menu) return null
  return <div className="modal-bg" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
    <h3>{menu.title || 'Options'}</h3>
    <div className="menu">{(menu.items||[]).map((it,i)=><button key={i} className={it.danger?'danger':''} onClick={()=>{ onClose(); it.onClick?.() }}>{it.label}</button>)}</div>
    <div style={{marginTop:10}}><button className="btn ghost block" onClick={onClose}>Close</button></div>
  </div></div>
}
