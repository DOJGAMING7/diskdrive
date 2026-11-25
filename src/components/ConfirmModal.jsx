import React, { useState } from 'react'
export default function ConfirmModal({ confirm, onClose }) {
  const [step, setStep] = useState(0)
  if (!confirm) return null
  const steps = confirm.steps || [confirm.message || 'Are you sure?']
  const last = step >= steps.length - 1
  return <div className="modal-bg" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
    <h3>{confirm.title || 'Confirm'}</h3>
    <p style={{color:'#bbb',lineHeight:1.5,marginTop:0}}>{steps[step]}</p>
    <div className="row">
      <button className="btn ghost" style={{flex:1}} onClick={onClose}>Cancel</button>
      <button className="btn" style={{flex:1}} onClick={()=>{ if (last) { onClose(); confirm.onConfirm?.() } else setStep(s=>s+1) }}>{last ? (confirm.confirmLabel||'Confirm') : 'Continue'}</button>
    </div>
  </div></div>
}
