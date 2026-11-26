import React, { useMemo, useState } from 'react'
import { fmtTime } from '../lib/store.js'

export default function HistoryScreen({ state, save, showToast, openPlayer, setConfirm }) {
  const [q, setQ] = useState('')
  const [provider, setProvider] = useState('ALL')
  const items = useMemo(() => (state.history||[]).filter(h => (provider==='ALL'||h.provider===provider) && (!q || (h.title||h.name||'').toLowerCase().includes(q.toLowerCase()))), [state.history,q,provider])
  const total = (state.history||[]).length
  const continueItem = (state.history||[]).find(h => (h.position||0) > 5)

  const removeOne = (id) => save({ history: (state.history||[]).filter(h=>h.id!==id) })
  const clearAll = () => setConfirm({ title:'Clear history', steps:['Clear all watch history?','Confirm again. This cannot be undone.'], confirmLabel:'Clear', onConfirm: async()=>{ await save({ history: [] }); showToast('History cleared') } })
  const play = (h) => openPlayer({ id:h.mediaId||h.id, title:h.title, name:h.name, src:h.src, sourceUrl:h.sourceUrl, thumb:h.thumb, thumbPath:h.thumbPath, provider:h.provider, kind:h.kind, position:h.position||0 }, items.map(x=>({id:x.mediaId||x.id,title:x.title,name:x.name,src:x.src,sourceUrl:x.sourceUrl,thumb:x.thumb,thumbPath:x.thumbPath,provider:x.provider,kind:x.kind,position:x.position||0})))

  return <div className="screen">
    <h1>History</h1>
    <p className="lead">Your watch activity stays private on this device in Plan 1. Sync interface is prepared for later backend.</p>
    <div className="card">
      <div className="row" style={{justifyContent:'space-between'}}>
        <div><div className="section-title" style={{margin:0}}>Watched</div><div style={{fontSize:24,fontWeight:800}}>{total}</div></div>
        <button className="btn ghost" onClick={clearAll}>Clear all</button>
      </div>
      {continueItem && <div style={{marginTop:12}}><button className="btn block" onClick={()=>play(continueItem)}>Continue watching: {continueItem.title}</button></div>}
    </div>
    <div className="card">
      <input className="input" placeholder="Search history" value={q} onChange={e=>setQ(e.target.value)} />
      <div className="chips" style={{marginTop:12,marginBottom:0}}>{['ALL','TERABOX','DISKWALA','LOCAL'].map(p=><button key={p} className={`chip ${provider===p?'active':''}`} onClick={()=>setProvider(p)}>{p}</button>)}</div>
    </div>
    <div className="card">
      <div className="list">
        {items.length===0 && <div className="empty">No history yet. Play a local video to see it here.</div>}
        {items.map(h => <div key={h.id} className="item">
          <div className="thumb" onClick={()=>play(h)} style={{position:'relative'}}>{h.thumb && !String(h.thumb).startsWith('blob:') ? <img src={h.thumb} alt="" /> : <span style={{fontSize:10,color:'var(--muted)'}}>No preview</span>}<div style={{position:'absolute',right:4,bottom:4,background:'rgba(0,0,0,.75)',color:'var(--fg)',fontSize:10,padding:'1px 4px',borderRadius:4}}>{fmtTime(h.position||0)}</div></div>
          <div className="meta" onClick={()=>play(h)}>
            <div className="title">{h.title||h.name}</div>
            <div className="sub">{h.provider||'LOCAL'} • {h.watchCount?`${h.watchCount} watch`:'Watched'} • {new Date(h.watchedAt||Date.now()).toLocaleString()}</div>
          </div>
          <button className="iconbtn" onClick={()=>removeOne(h.id)} title="Remove">✕</button>
        </div>)}
      </div>
    </div>
  </div>
}
