import React, { useEffect, useRef, useState } from 'react'
import { fmtTime } from '../lib/store.js'

export default function Player({ item, queue=[], onClose, onProgress, onSelect, showToast }) {
  const wrapRef = useRef(null)
  const videoRef = useRef(null)
  const hideTimer = useRef(null)
  const holdTimer = useRef(null)
  const lastTap = useRef({ t:0, side:null })
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [show, setShow] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [hold2x, setHold2x] = useState(false)
  const [lockedUI, setLockedUI] = useState(false)
  const [fs, setFs] = useState(false)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [useDirect, setUseDirect] = useState(false)
  const [showQueue, setShowQueue] = useState(false)
  const [zoom, setZoom] = useState('contain') // contain|cover|fill
  const [fsMode, setFsMode] = useState('auto') // auto|landscape|portrait
  const [quality, setQuality] = useState('auto')
  const [pipMsg, setPipMsg] = useState('')
  const touchY = useRef(null)
  const seekingRef = useRef(false)
  const idx = Math.max(0, queue.findIndex(q => q.id===item.id || (q.src && q.src===item.src)))

  useEffect(() => { setUseDirect(false) }, [item?.id, item?.src, item?.directUrl])

  useEffect(() => {
    const v = videoRef.current; if (!v) return
    setErr(''); setLoading(true); setPlaying(false); setCurrentTime(0); setDuration(0); setBuffered(0)
    const chosen = (useDirect && item.directUrl) ? item.directUrl : item.src
    v.src = chosen
    v.load()
    const onLoaded = () => { setDuration(v.duration||0); setLoading(false); if (item.position && item.position < (v.duration||99999)-3) v.currentTime = item.position; v.play().then(()=>setPlaying(true)).catch(()=>{}) }
    const onTime = () => { setCurrentTime(v.currentTime||0); onProgress?.(item.src, v.currentTime||0, v.duration||0); if (v.buffered?.length) { const end=v.buffered.end(v.buffered.length-1); setBuffered(v.duration? (end/v.duration)*100:0) } }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onWait = () => setLoading(true)
    const onCan = () => setLoading(false)
    const onEnd = () => { setPlaying(false); if (queue[idx+1]) onSelect(queue[idx+1]) }
    const onErr = () => {
      setLoading(false)
      if (!useDirect && item.directUrl && item.directUrl !== v.src) {
        setErr('Proxy playback failed. Trying direct link…')
        setUseDirect(true)
        return
      }
      setErr('Cannot play this video file. Try Open in other player or Download.')
    }
    v.addEventListener('loadedmetadata', onLoaded)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('waiting', onWait)
    v.addEventListener('canplay', onCan)
    v.addEventListener('ended', onEnd)
    v.addEventListener('error', onErr)
    return () => { v.pause(); v.removeEventListener('loadedmetadata', onLoaded); v.removeEventListener('timeupdate', onTime); v.removeEventListener('play', onPlay); v.removeEventListener('pause', onPause); v.removeEventListener('waiting', onWait); v.removeEventListener('canplay', onCan); v.removeEventListener('ended', onEnd); v.removeEventListener('error', onErr) }
  }, [item?.src, item?.directUrl, useDirect])

  useEffect(() => { const v=videoRef.current; if(v) v.playbackRate = hold2x ? 2 : speed }, [speed, hold2x])
  useEffect(() => { const onFs=()=> setFs(!!document.fullscreenElement); document.addEventListener('fullscreenchange', onFs); return ()=>document.removeEventListener('fullscreenchange', onFs) }, [])
  useEffect(() => () => { clearTimeout(hideTimer.current); clearTimeout(holdTimer.current) }, [])

  const poke = (force=false) => { setShow(true); clearTimeout(hideTimer.current); hideTimer.current = setTimeout(()=>{ if(!force) setShow(false) }, 2600) }
  const togglePlay = () => { const v=videoRef.current; if(!v) return; if(v.paused) v.play().catch(()=>{}); else v.pause(); poke() }
  const seekBy = (d) => { const v=videoRef.current; if(!v) return; v.currentTime = Math.min(Math.max(0, (v.currentTime||0)+d), v.duration||0); setShow(true); clearTimeout(hideTimer.current); hideTimer.current = setTimeout(()=>setShow(false), 1800) }
  const seekToClientX = (clientX, target) => {
    const v = videoRef.current; if (!v || !duration) return
    const r = target.getBoundingClientRect()
    const x = Math.min(Math.max(0, clientX - r.left), r.width)
    v.currentTime = (x / r.width) * duration
    setCurrentTime(v.currentTime)
  }
  const onSeekPointerDown = (e) => { seekingRef.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); seekToClientX(e.clientX, e.currentTarget); poke() }
  const onSeekPointerMove = (e) => { if (!seekingRef.current) return; seekToClientX(e.clientX, e.currentTarget) }
  const onSeekPointerUp = (e) => { if (!seekingRef.current) return; seekingRef.current = false; seekToClientX(e.clientX, e.currentTarget); poke() }
  const applyOrientation = async () => {
    try {
      if (fsMode === 'landscape') await (screen.orientation?.lock?.('landscape-primary') || screen.orientation?.lock?.('landscape'))
      else if (fsMode === 'portrait') await (screen.orientation?.lock?.('portrait-primary') || screen.orientation?.lock?.('portrait'))
      else {
        const v = videoRef.current
        const isLandscapeVideo = (v?.videoWidth||0) >= (v?.videoHeight||0)
        await (screen.orientation?.lock?.(isLandscapeVideo ? 'landscape-primary' : 'portrait-primary'))
      }
    } catch {}
  }
  const toggleFs = async () => {
    try {
      const el = wrapRef.current
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        if (el?.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' }).catch(()=>el.requestFullscreen())
        else if (el?.webkitRequestFullscreen) el.webkitRequestFullscreen()
        else if (videoRef.current?.webkitEnterFullscreen) videoRef.current.webkitEnterFullscreen()
        await applyOrientation()
      } else {
        try { await screen.orientation?.unlock?.() } catch {}
        if (document.exitFullscreen) await document.exitFullscreen()
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen()
      }
    } catch {}
    poke()
  }
  const togglePiP = async () => {
    try {
      const v=videoRef.current; if (!v) return
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else if (v.requestPictureInPicture) await v.requestPictureInPicture()
      else if (v.webkitSetPresentationMode) v.webkitSetPresentationMode(v.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture')
      else { setPipMsg('Picture-in-Picture not supported on this device/browser'); setTimeout(()=>setPipMsg(''), 2500) }
    } catch { setPipMsg('Picture-in-Picture not supported on this device/browser'); setTimeout(()=>setPipMsg(''), 2500) }
    poke()
  }

  const onTapZone = (side) => {
    if (lockedUI) { setShow(s=>!s); return }
    if (hold2x) return
    const nowTs = Date.now()
    if (side !== 'center' && lastTap.current.side===side && nowTs-lastTap.current.t < 300) {
      seekBy(side==='left' ? -10 : 10)
      lastTap.current = { t:0, side:null }
      return
    }
    lastTap.current = { t:nowTs, side }
    setTimeout(()=>{ if (Date.now()-lastTap.current.t >= 280 && lastTap.current.side===side) { setShow(s=>!s); lastTap.current={t:0,side:null} } }, 290)
  }

  const onPointerDown = (side) => { if (lockedUI) return; if (side !== 'right') return; clearTimeout(holdTimer.current); holdTimer.current = setTimeout(()=>{ setHold2x(true); setShow(false) }, 350) }
  const onPointerUp = () => { clearTimeout(holdTimer.current); if (hold2x) { setHold2x(false); poke() } }

  return <div className="player-wrap" ref={wrapRef} style={{position:'fixed',inset:0,background:'#000',zIndex:300,color:'#fff'}}>
    <video ref={videoRef} playsInline preload="metadata" style={{width:'100%',height:'100%',objectFit:zoom,background:'#000'}} />
    <div style={{position:'absolute',inset:0,display:'grid',gridTemplateColumns:'1fr 1fr 1fr'}} onMouseMove={poke} onTouchStart={(e)=>{ poke(); touchY.current = e.touches?.[0]?.clientY ?? null }} onTouchEnd={(e)=>{ const endY = e.changedTouches?.[0]?.clientY; if (touchY.current!=null && endY!=null && touchY.current-endY > 70 && queue.length>1) setShowQueue(true); touchY.current=null }}>
      <div onClick={()=>onTapZone('left')} onPointerDown={()=>onPointerDown('left')} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} />
      <div onClick={()=>onTapZone('center')} onPointerDown={()=>onPointerDown('center')} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} />
      <div onClick={()=>onTapZone('right')} onPointerDown={()=>onPointerDown('right')} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} />
    </div>

    {(show || !playing || loading || err) && <div style={{position:'absolute',inset:0,background:'linear-gradient(to bottom,rgba(0,0,0,.65),rgba(0,0,0,0) 28%,rgba(0,0,0,0) 65%,rgba(0,0,0,.78))',pointerEvents:'none'}} />}
    {(show || !playing || loading || err) && <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',justifyContent:'space-between',padding:'max(14px,env(safe-area-inset-top)) 14px max(14px,env(safe-area-inset-bottom))'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',pointerEvents:'auto'}}>
        {!lockedUI && <button className="iconbtn" onClick={onClose} style={{background:'rgba(0,0,0,.45)'}}>✕</button>}
        {!lockedUI && <div style={{display:'flex',alignItems:'center',gap:10,flex:1,minWidth:0}}>
          <div style={{width:52,height:32,borderRadius:8,overflow:'hidden',background:'#111',border:'1px solid #333',display:'grid',placeItems:'center',flex:'0 0 auto'}}>{item.thumb && !String(item.thumb).startsWith('blob:') ? <img src={item.thumb} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/> : <span style={{fontSize:10,color:'#888'}}>VID</span>}</div>
          <div style={{minWidth:0}}><div style={{fontWeight:700,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{item.title||item.name}</div><div className="small">{hold2x?'2x speed':`${speed}x`}{item.provider?` • ${item.provider}`:''}</div></div>
        </div>}
        <button className="iconbtn" onClick={()=>setLockedUI(v=>!v)} style={{background:'rgba(0,0,0,.45)',marginLeft: lockedUI?'auto':0}}>{lockedUI?'🔒':'🔓'}</button>
      </div>

      {!lockedUI && <div style={{display:'flex',justifyContent:'center',alignItems:'center',gap:18,pointerEvents:'auto'}}>
        <button className="iconbtn" onClick={()=>seekBy(-10)} style={{width:52,height:52}}>↺10</button>
        <button className="iconbtn" onClick={togglePlay} style={{width:68,height:68,fontSize:24}}>{playing?'⏸':'▶'}</button>
        <button className="iconbtn" onClick={()=>seekBy(10)} style={{width:52,height:52}}>10↻</button>
      </div>}

      {!lockedUI && <div style={{pointerEvents:'auto'}}>
        {err && <div style={{marginBottom:10,fontSize:13}}>
          <div>{err}</div>
          <div className="row" style={{marginTop:8}}>
            {(item.directUrl || item.src) && <button className="btn ghost" onClick={()=>window.open(item.directUrl || item.src, '_blank', 'noopener,noreferrer')}>Open in other player</button>}
            {(item.downloadUrl || item.directUrl || item.src) && <a className="btn ghost" href={item.downloadUrl || item.directUrl || item.src} target="_blank" rel="noopener noreferrer" download={item.name||'video.mp4'}>Download</a>}
          </div>
        </div>}
        {pipMsg && <div style={{marginBottom:10,fontSize:13}}>{pipMsg}</div>}
        {loading && !err && <div style={{marginBottom:10,fontSize:13}}>Loading…</div>}
        <div style={{height:34,display:'flex',alignItems:'center',cursor:'pointer',touchAction:'none'}} onPointerDown={onSeekPointerDown} onPointerMove={onSeekPointerMove} onPointerUp={onSeekPointerUp} onPointerCancel={onSeekPointerUp}>
          <div style={{position:'relative',width:'100%',height:6,background:'rgba(255,255,255,.2)',borderRadius:999}}>
            <div style={{position:'absolute',left:0,top:0,bottom:0,width:`${buffered}%`,background:'rgba(255,255,255,.28)',borderRadius:999}} />
            <div style={{position:'absolute',left:0,top:0,bottom:0,width:`${duration?(currentTime/duration)*100:0}%`,background:'#fff',borderRadius:999}} />
            <div style={{position:'absolute',top:'50%',left:`${duration?(currentTime/duration)*100:0}%`,width:14,height:14,borderRadius:999,background:'#fff',transform:'translate(-50%,-50%)',boxShadow:'0 0 0 3px rgba(255,255,255,.15)'}} />
          </div>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'#ddd',marginBottom:10}}><span>{fmtTime(currentTime)}</span><span>{fmtTime(duration)}</span></div>
        <div className="row" style={{justifyContent:'space-between'}}>
          <div className="row">
            <select className="input" style={{width:88,padding:'8px 10px'}} value={speed} onChange={e=>setSpeed(Number(e.target.value))}>
              {[0.5,0.75,1,1.25,1.5,2].map(s=><option key={s} value={s}>{s}x</option>)}
            </select>
            <select className="input" style={{width:92,padding:'8px 10px'}} value={quality} onChange={e=>{ setQuality(e.target.value); (showToast?showToast('Quality switching depends on source; Auto used'):null) }}>
              {['auto','1080p','720p','480p','360p'].map(q=><option key={q} value={q}>{q}</option>)}
            </select>
            <select className="input" style={{width:92,padding:'8px 10px'}} value={zoom} onChange={e=>setZoom(e.target.value)}>
              <option value="contain">Fit</option><option value="cover">Zoom</option><option value="fill">Stretch</option>
            </select>
            <select className="input" style={{width:110,padding:'8px 10px'}} value={fsMode} onChange={e=>setFsMode(e.target.value)}>
              <option value="auto">FS Auto</option><option value="landscape">FS Horizontal</option><option value="portrait">FS Vertical</option>
            </select>
            <button className="btn ghost" onClick={togglePiP}>PiP</button>
            {queue.length>1 && <button className="btn ghost" onClick={()=>setShowQueue(v=>!v)}>Queue</button>}
            {queue[idx-1] && <button className="btn ghost" onClick={()=>onSelect(queue[idx-1])}>Prev</button>}
            {queue[idx+1] && <button className="btn ghost" onClick={()=>onSelect(queue[idx+1])}>Next</button>}
          </div>
          <button className="btn ghost" onClick={toggleFs}>{fs?'Exit':'Fullscreen'}</button>
        </div>
      </div>}
    </div>}

    {showQueue && queue.length>1 && <div style={{position:'absolute',left:0,right:0,bottom:0,maxHeight:'55%',background:'rgba(0,0,0,.94)',borderTop:'1px solid #333',padding:'12px 14px max(14px,env(safe-area-inset-bottom))',overflow:'auto',pointerEvents:'auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}><div style={{fontWeight:700}}>Up next / Playlist</div><button className="iconbtn" onClick={()=>setShowQueue(false)}>✕</button></div>
      <div className="list" style={{gap:8}}>
        {queue.map((q,i)=><button key={q.id||i} onClick={()=>{ onSelect(q); setShowQueue(false) }} style={{display:'flex',gap:10,alignItems:'center',textAlign:'left',background:i===idx?'#151515':'transparent',border:'1px solid #222',borderRadius:12,padding:8,color:'#fff'}}>
          <div style={{width:64,height:40,borderRadius:8,overflow:'hidden',background:'#111',flex:'0 0 auto',display:'grid',placeItems:'center'}}>{q.thumb && !String(q.thumb).startsWith('blob:') ? <img src={q.thumb} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:<span style={{fontSize:10,color:'#777'}}>VID</span>}</div>
          <div style={{minWidth:0}}><div style={{fontSize:14,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{q.title||q.name}</div><div style={{fontSize:12,color:'#aaa'}}>{i===idx?'Now playing':'Tap to play'}{q.date?` • ${q.date}`:''}</div></div>
        </button>)}
      </div>
    </div>}
  </div>
}
