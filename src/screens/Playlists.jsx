import React, { useMemo, useState } from 'react'
import { I } from '../components/Icons.jsx'
import { uid, now } from '../lib/id.js'
import { importLocalFile } from '../lib/files.js'
import { shareItem as nativeShare } from '../lib/export.js'

export default function PlaylistScreen({ state, save, showToast, openPlayer, setMenu, setConfirm }) {
  const [selected, setSelected] = useState('watch-later')
  const [filter, setFilter] = useState('recent')
  const playlists = state.playlists || []
  const active = playlists.find(p=>p.id===selected) || playlists[0]
  const items = useMemo(() => {
    const arr = [...(active?.items||[])]
    if (filter==='recent') arr.sort((a,b)=>(b.addedAt||0)-(a.addedAt||0))
    return arr
  }, [active, filter])

  const addLocalToPlaylist = async (e) => {
    const file = e.target.files?.[0]; e.target.value=''
    if (!file || !active) return
    try {
      const media = await importLocalFile(file)
      const next = playlists.map(p => p.id===active.id ? { ...p, items:[{...media, addedAt:now()}, ...(p.items||[])], updatedAt:now() } : p)
      await save({ playlists: next })
      showToast('Added to playlist')
    } catch { showToast('Could not add file') }
  }
  const createPlaylist = async () => {
    const name = prompt('Playlist name')
    if (!name?.trim()) return
    const pl = { id: uid(), name: name.trim().toUpperCase(), builtIn:false, items:[], updatedAt: now() }
    await save({ playlists: [...playlists, pl] }); setSelected(pl.id)
  }
  const rename = async (pl) => {
    const name = prompt('Rename playlist', pl.name)
    if (!name?.trim()) return
    await save({ playlists: playlists.map(p=>p.id===pl.id?{...p,name:name.trim().toUpperCase(),updatedAt:now()}:p) })
  }
  const delPlaylist = (pl) => {
    if (pl.builtIn) return showToast('Built-in playlists cannot be deleted')
    setConfirm({ title:'Delete playlist', steps:[`Delete "${pl.name}"?`,'Confirm again. This cannot be undone.'], confirmLabel:'Delete', onConfirm: async()=>{ const next=playlists.filter(p=>p.id!==pl.id); await save({ playlists: next }); setSelected('watch-later') } })
  }
  const removeItem = async (pl, itemId) => {
    await save({ playlists: playlists.map(p=>p.id===pl.id?{...p,items:p.items.filter(i=>i.id!==itemId),updatedAt:now()}:p) })
  }
  const moveItem = async (pl, item) => {
    const targets = playlists.filter(p=>p.id!==pl.id)
    if (!targets.length) return
    const name = prompt('Move to playlist name:\n' + targets.map(t=>`- ${t.name}`).join('\n'), targets[0].name)
    const target = targets.find(t=>t.name.toLowerCase()===String(name||'').toLowerCase())
    if (!target) return showToast('Playlist not found')
    const next = playlists.map(p => {
      if (p.id===pl.id) return { ...p, items:p.items.filter(i=>i.id!==item.id), updatedAt:now() }
      if (p.id===target.id) return { ...p, items:[{...item, addedAt:now()}, ...p.items], updatedAt:now() }
      return p
    })
    await save({ playlists: next }); showToast(`Moved to ${target.name}`)
  }
  const shareItem = async (item) => {
    try { await nativeShare(item) } catch { showToast('Share not available') }
  }
  const playAll = () => { if (!items.length) return; openPlayer(items[0], items) }
  const shuffle = () => { if (!items.length) return; const arr=[...items].sort(()=>Math.random()-0.5); openPlayer(arr[0], arr) }

  return <div className="screen">
    <h1>Playlists</h1>
    <p className="lead">Organize local videos into playlists. Plan 1 is local-first; backend sync comes later.</p>
    <div className="card">
      <div className="row" style={{justifyContent:'space-between'}}>
        <div className="section-title" style={{margin:0}}>Your playlists</div>
        <button className="btn ghost" onClick={createPlaylist}>New</button>
      </div>
      <div className="list" style={{marginTop:12}}>
        {playlists.map(pl => <div key={pl.id} className={`item ${selected===pl.id?'active':''}`} style={selected===pl.id?{borderColor:'#fff'}:{}}>
          <div className="meta" onClick={()=>setSelected(pl.id)}>
            <div className="title">{pl.name}</div>
            <div className="sub">{pl.items.length} videos • {new Date(pl.updatedAt||Date.now()).toLocaleDateString()}</div>
          </div>
          <button className="iconbtn" onClick={()=>setMenu({ title:pl.name, items:[
            {label:'Rename', onClick:()=>rename(pl)},
            ...(!pl.builtIn?[{label:'Delete playlist', danger:true, onClick:()=>delPlaylist(pl)}]:[])
          ]})}><I.dots/></button>
        </div>)}
      </div>
    </div>

    <div className="card">
      <div className="row" style={{justifyContent:'space-between'}}>
        <div><div className="section-title" style={{margin:0}}>{active?.name}</div><div className="small">{items.length} videos</div></div>
        <div className="row">
          <label className="btn ghost" style={{margin:0}}>Add local<input type="file" accept="video/*" hidden onChange={addLocalToPlaylist} /></label>
        </div>
      </div>
      <div className="chips" style={{marginTop:12}}>
        <button className={`chip ${filter==='recent'?'active':''}`} onClick={()=>setFilter('recent')}>Recently added</button>
        <button className={`chip ${filter==='all'?'active':''}`} onClick={()=>setFilter('all')}>All</button>
      </div>
      <div className="row" style={{marginBottom:12}}>
        <button className="btn" onClick={playAll}>Play all</button>
        <button className="btn ghost" onClick={shuffle}>Shuffle</button>
      </div>
      <div className="list">
        {items.length===0 && <div className="empty">No videos in this playlist yet.</div>}
        {items.map(item => <div key={item.id} className="item">
          <div className="thumb" onClick={()=>openPlayer(item, items)}><I.play/></div>
          <div className="meta" onClick={()=>openPlayer(item, items)}>
            <div className="title">{item.title||item.name}</div>
            <div className="sub">{item.provider||'LOCAL'}</div>
          </div>
          <button className="iconbtn" onClick={()=>setMenu({ title:item.title||item.name, items:[
            {label:'Remove from playlist', danger:true, onClick:()=>removeItem(active,item.id)},
            {label:'Move', onClick:()=>moveItem(active,item)},
            {label:'Share', onClick:()=>shareItem(item)},
          ]})}><I.dots/></button>
        </div>)}
      </div>
    </div>
  </div>
}
