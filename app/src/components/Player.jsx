import React, { useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { fmtTime } from '../lib/store.js'

import { resolveTeraboxLink } from '../lib/terabox.js'

const isLocalMediaSrc = (src='') => /^(capacitor:|file:|blob:|data:|content:)/i.test(String(src || '')) || String(src || '').includes('/_capacitor_file_/')
const PLAYCACHE_DIR = 'playcache'
const MAX_CACHE_FILES = 6

async function cleanupPlayCache(currentPath='') {
  try {
    if (!Capacitor.isNativePlatform()) return
    const res = await Filesystem.readdir({ path: PLAYCACHE_DIR, directory: Directory.Cache })
    const files = (res?.files || []).map(f => typeof f === 'string' ? { name: f } : f).filter(f => f?.name)
    if (files.length <= MAX_CACHE_FILES) return
    const withStat = []
    for (const f of files) {
      const full = `${PLAYCACHE_DIR}/${f.name}`
      if (currentPath && full === currentPath) continue
      try {
        const st = await Filesystem.stat({ path: full, directory: Directory.Cache })
        withStat.push({ full, mtime: Number(st?.mtime || 0), size: Number(st?.size || 0) })
      } catch {}
    }
    withStat.sort((a,b) => a.mtime - b.mtime)
    const toDelete = withStat.slice(0, Math.max(0, withStat.length - (MAX_CACHE_FILES - 1)))
    for (const f of toDelete) {
      try { await Filesystem.deleteFile({ path: f.full, directory: Directory.Cache }) } catch {}
    }
  } catch {}
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error('read failed'))
    r.onload = () => { const s = String(r.result || ''); resolve(s.includes(',') ? s.split(',')[1] : s) }
    r.readAsDataURL(blob)
  })
}

export default function Player({ item, queue=[], onClose, onProgress, onSelect, showToast, enqueueDownload, cancelDownload, downloadJobs=[], teraboxCookie='', downloadDir='Download' }) {
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
  const [useFallback, setUseFallback] = useState(false)
  const resolveAttempts = useRef(0)
  const activeRunRef = useRef(0)
  const itemRef = useRef(item)
  itemRef.current = item
  const [showQueue, setShowQueue] = useState(false)
  const [zoom, setZoom] = useState('contain') // contain|cover|fill
  const [fsMode, setFsMode] = useState('auto') // auto|landscape|portrait
  const [quality, setQuality] = useState('auto')
  const [pipMsg, setPipMsg] = useState('')
  const [showInfo, setShowInfo] = useState(false)
  const [resolving, setResolving] = useState(false)
  const touchY = useRef(null)
  const seekingRef = useRef(false)
  const idx = Math.max(0, queue.findIndex(q => q.id===item.id || (q.src && q.src===item.src)))
  const activeJob = (downloadJobs||[]).find(j => ['queued','downloading','resolving'].includes(j.status) && (j.sourceUrl===item.sourceUrl || j.src===item.src || j.itemId===item.id))

  useEffect(() => { setUseFallback(false); resolveAttempts.current = 0; setResolving(false) }, [item?.id, item?.sourceUrl])

  useEffect(() => {
    const runId = ++activeRunRef.current
    const stale = () => runId !== activeRunRef.current
    const v = videoRef.current; if (!v) return
    setErr(''); setLoading(true); setPlaying(false); setCurrentTime(0); setDuration(0); setBuffered(0)
    const chosen = item.srcLocal || ((!useFallback && (item.directUrl || item.src)) ? (item.directUrl || item.src) : (item.src || item.directUrl))
    if (!chosen) { setLoading(false); setErr('No playable source for this item.'); return }
    v.src = chosen
    v.load()
    const onLoaded = () => { if (stale()) return; setDuration(v.duration||0); setLoading(false); if (item.position && item.position < (v.duration||99999)-3) v.currentTime = item.position; v.play().then(()=>{ if (!stale()) setPlaying(true) }).catch(()=>{}) }
    const onTime = () => { if (stale()) return; setCurrentTime(v.currentTime||0); onProgress?.(item.srcLocal || item.src, v.currentTime||0, v.duration||0); if (v.buffered?.length) { const end=v.buffered.end(v.buffered.length-1); setBuffered(v.duration? (end/v.duration)*100:0) } }
    const onPlay = () => { if (!stale()) setPlaying(true) }
    const onPause = () => { if (!stale()) setPlaying(false) }
    const onWait = () => { if (!stale()) setLoading(true) }
    const onStalled = () => { if (!stale()) setLoading(true) }
    const onCan = () => { if (!stale()) setLoading(false) }
    const onEnd = () => { if (stale()) return; setPlaying(false); if (queue[idx+1]) onSelect(queue[idx+1]) }

    const tryDownloadToCache = async (currentItem) => {
      const candidates = [currentItem.directUrl, currentItem.downloadUrl, currentItem.src, currentItem.proxyDownloadUrl, currentItem.proxyStreamUrl]
        .map(v => String(v || '').trim()).filter((u, i, a) => u && /^https?:/i.test(u) && a.indexOf(u) === i)
      if (!candidates.length) throw new Error('No direct download URL available')
      const ext = String(currentItem.name || currentItem.title || 'video.mp4').split('.').pop()?.replace(/[^a-z0-9]/ig,'') || 'mp4'
      const path = `${PLAYCACHE_DIR}/${(currentItem.id || 'vid').replace(/[^a-zA-Z0-9_-]/g,'')}.${ext}`
      try { await Filesystem.mkdir({ path: PLAYCACHE_DIR, directory: Directory.Cache, recursive: true }) } catch {}
      const cookie = String(teraboxCookie || '').trim()
      const isTeraboxLike = (u='') => { try { return /terabox|1024tera|4funbox|mirrobox|nephobox|momerybox|tibibox/.test(new URL(u).hostname.toLowerCase()) } catch { return false } }
      const makeHeaderVariants = (srcUrl) => {
        const ua = 'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
        const shareOrigin = (() => { try { return new URL(currentItem.sourceUrl || srcUrl).origin + '/' } catch { return 'https://www.terabox.com/' } })()
        const base = { 'Accept': '*/*', 'User-Agent': ua }
        const variants = [
          { name: 'no-cookie,terabox-ref', headers: { ...base, 'Referer': 'https://www.terabox.com/' } },
          { name: 'no-cookie,share-ref', headers: { ...base, 'Referer': shareOrigin } },
          { name: 'no-cookie,no-ref', headers: { ...base } },
        ]
        if (cookie && isTeraboxLike(srcUrl)) {
          const ck = cookie.includes('ndus=') ? cookie : `ndus=${cookie}`
          variants.push({ name: 'cookie,terabox-ref', headers: { ...base, 'Referer': 'https://www.terabox.com/', 'Cookie': ck } })
        }
        return variants
      }

      const attemptDownload = async (srcUrl, candIdx, candTotal) => {
        const variants = makeHeaderVariants(srcUrl)
        let lastErr
        for (let vi = 0; vi < variants.length; vi++) {
          if (stale()) throw new Error('cancelled')
          const vopt = variants[vi]
          try {
            if (!stale()) setErr(`Downloading local playback cache… (${candIdx}/${candTotal}, try ${vi + 1}/${variants.length})`)
            try {
              await Filesystem.downloadFile({ url: srcUrl, path, directory: Directory.Cache, headers: vopt.headers, progress: false })
            } catch (nativeErr) {
              if (stale()) throw new Error('cancelled')
              const fres = await fetch(srcUrl, { headers: vopt.headers, credentials: 'omit' })
              if (!fres.ok) throw new Error(`HTTP ${fres.status} (${vopt.name})`)
              const blob = await fres.blob()
              if (!blob?.size) throw nativeErr
              const b64 = await blobToBase64(blob)
              if (stale()) throw new Error('cancelled')
              await Filesystem.writeFile({ path, directory: Directory.Cache, data: b64, recursive: true })
            }
            const stat = await Filesystem.stat({ path, directory: Directory.Cache }).catch(() => null)
            if (!stat?.size) throw new Error('Downloaded file is empty')
            const uri = await Filesystem.getUri({ path, directory: Directory.Cache })
            const local = Capacitor.convertFileSrc(uri.uri)
            cleanupPlayCache(path)
            return local
          } catch (e) {
            lastErr = e
            try { await Filesystem.deleteFile({ path, directory: Directory.Cache }) } catch {}
          }
        }
        throw lastErr || new Error('Download failed')
      }

      let lastErr
      for (let i = 0; i < candidates.length; i++) {
        if (stale()) throw new Error('cancelled')
        const srcUrl = candidates[i]
        try {
          if (!stale()) setErr(`Downloading local playback cache… (${i + 1}/${candidates.length})`)
          return await attemptDownload(srcUrl, i + 1, candidates.length)
        } catch (e) {
          lastErr = e
        }
      }
      throw lastErr || new Error('Download failed')
    }

    const onErr = async () => {
      if (stale()) return
      setLoading(false)
      const currentItem = itemRef.current || item
      const currentChosen = currentItem.srcLocal || ((!useFallback && (currentItem.directUrl || currentItem.src)) ? (currentItem.directUrl || currentItem.src) : (currentItem.src || currentItem.directUrl))
      const canFallback = !useFallback && currentItem.src && currentItem.directUrl && currentItem.src !== currentItem.directUrl
      if (canFallback) { setErr('Trying alternate stream source…'); setUseFallback(true); return }

      const localLike = isLocalMediaSrc(currentChosen)
      if (!localLike && currentItem.sourceUrl && teraboxCookie && resolveAttempts.current < 2) {
        resolveAttempts.current += 1
        try {
          setErr('Re-resolving link on device…')
          setLoading(true)
          const fresh = await resolveTeraboxLink(currentItem.sourceUrl, { teraboxCookie })
          if (stale()) return
          setLoading(false)
          const next = { ...currentItem, ...fresh }
          if ((next.src || next.directUrl) && (next.src !== currentItem.src || next.directUrl !== currentItem.directUrl || next.srcLocal !== currentItem.srcLocal)) {
            onSelect(next)
            return
          }
        } catch (e) {
          if (stale()) return
          setLoading(false)
          const msg = String(e?.message || e)
          const isAuth = /cookie\/auth failed|login required|ndus expired|errno=(-6|-1|4|5|112|910000001)\b/i.test(msg)
          if (isAuth) { setErr('Terabox NDUS/cookie invalid or expired. Update it in Settings.'); return }
        }
      }

      if (Capacitor?.isNativePlatform?.() && !isLocalMediaSrc(currentItem.srcLocal) && (currentItem.directUrl || currentItem.src || currentItem.downloadUrl || currentItem.sourceUrl)) {
        try {
          setErr('Direct stream failed. Downloading local playback cache…')
          setLoading(true)
          let local = null
          let lastErr = null
          try { local = await tryDownloadToCache(currentItem) } catch (e) { lastErr = e }
          if (!local && currentItem.sourceUrl && teraboxCookie && resolveAttempts.current < 3) {
            resolveAttempts.current += 1
            try {
              setErr('Refreshing Terabox link and retrying…')
              const fresh = await resolveTeraboxLink(currentItem.sourceUrl, { teraboxCookie })
              if (stale()) return
              const next = { ...currentItem, ...fresh }
              local = await tryDownloadToCache(next)
              if (local) { setLoading(false); setErr(''); onSelect({ ...next, srcLocal: local, src: local }); return }
            } catch (e) { lastErr = e }
          }
          if (stale()) return
          if (local) {
            setLoading(false)
            setErr('')
            onSelect({ ...currentItem, srcLocal: local, src: local })
            return
          }
          throw lastErr || new Error('Could not download playback cache')
        } catch (e) {
          if (stale()) return
          setLoading(false)
          const msg = String(e?.message || e)
          const isAuth = /cookie\/auth failed|login required|ndus expired|errno=(-6|-1|4|5|112|910000001)\b/i.test(msg)
          setErr(isAuth ? 'Terabox NDUS/cookie invalid or expired. Update it in Settings.' : `Cannot play/download stream. ${msg.slice(0,180)}`)
          return
        }
      }
      if (stale()) return
      setLoading(false)
      setErr(currentItem.sourceUrl ? 'Cannot play this video. Try Download/Open link, or re-resolve after updating NDUS.' : 'Cannot play this video file.')
    }

    v.addEventListener('loadedmetadata', onLoaded)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('waiting', onWait)
    v.addEventListener('stalled', onStalled)
    v.addEventListener('canplay', onCan)
    v.addEventListener('canplaythrough', onCan)
    v.addEventListener('ended', onEnd)
    v.addEventListener('error', onErr)
    return () => { v.pause(); v.removeEventListener('loadedmetadata', onLoaded); v.removeEventListener('timeupdate', onTime); v.removeEventListener('play', onPlay); v.removeEventListener('pause', onPause); v.removeEventListener('waiting', onWait); v.removeEventListener('stalled', onStalled); v.removeEventListener('canplay', onCan); v.removeEventListener('canplaythrough', onCan); v.removeEventListener('ended', onEnd); v.removeEventListener('error', onErr) }
  }, [item?.id, item?.src, item?.srcLocal, item?.directUrl, item?.downloadUrl, item?.sourceUrl, useFallback, teraboxCookie])

  useEffect(() => { const v=videoRef.current; if(v) v.playbackRate = hold2x ? 2 : speed }, [speed, hold2x])
  useEffect(() => { const onFs=()=> setFs(!!document.fullscreenElement); document.addEventListener('fullscreenchange', onFs); return ()=>document.removeEventListener('fullscreenchange', onFs) }, [])
  useEffect(() => () => { activeRunRef.current += 1; clearTimeout(hideTimer.current); clearTimeout(holdTimer.current) }, [])

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
    <video ref={videoRef} playsInline preload="auto" style={{width:'100%',height:'100%',objectFit:zoom,background:'#000'}} />
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
          <div style={{minWidth:0}}><div style={{fontWeight:700,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{item.title||item.name}</div><div className="small">{hold2x?'2x speed':`${speed}x`}{item.provider?` • ${item.provider}`:''}{activeJob?` • ${activeJob.status} ${activeJob.progress||0}%`:''}</div></div>
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
            {(item.directUrl || item.src) && <button className="btn ghost" onClick={()=>window.open(item.directUrl || item.src, '_blank', 'noopener,noreferrer')}>Open link</button>}
            {activeJob ? <button className="btn ghost" onClick={()=>cancelDownload?.(activeJob.id)}>Cancel {activeJob.progress||0}%</button> : <button className="btn ghost" onClick={()=>{ if (item?.nativePath || item?.stored==='app-private' || item?.stored==='native-external') { import('../lib/export.js').then(m=>m.saveToPhone(item, downloadDir)).then(()=>showToast?.('Saved to device')).catch(()=>showToast?.('Save failed')); return } if(enqueueDownload) enqueueDownload(item); else window.open(item.downloadUrl||item.directUrl||item.src,'_blank') }}>{(item?.nativePath||item?.stored==='app-private'||item?.stored==='native-external')?'Save to phone':'Download'}</button>}
            {item.sourceUrl && <button className="btn ghost" disabled={resolving} onClick={async()=>{ try{ if(!teraboxCookie){ setErr('Add Terabox NDUS in Settings first.'); return } setResolving(true); setLoading(true); setErr('Re-resolving...'); const fresh=await resolveTeraboxLink(item.sourceUrl,{teraboxCookie}); if(fresh?.src||fresh?.directUrl) { onSelect({...item,...fresh}); } else setErr('Resolve returned no playable link.'); }catch(e){ const msg=String(e?.message||e); const isAuth=/cookie\/auth failed|login required|ndus expired|errno=(-6|-1|4|5|112|910000001)\b/i.test(msg); setErr(isAuth?'Terabox NDUS/cookie invalid or expired. Update it in Settings.':msg.slice(0,220)) } finally { setLoading(false); setResolving(false) } }}> {resolving?'Resolving…':'Re-resolve'}</button>}
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
        <div className="row" style={{justifyContent:'space-between',flexWrap:'wrap'}}>
          <div className="row" style={{flexWrap:'wrap'}}>
            <select className="input" style={{width:88,padding:'8px 10px'}} value={speed} onChange={e=>setSpeed(Number(e.target.value))}>
              {[0.5,0.75,1,1.25,1.5,2].map(s=><option key={s} value={s}>{s}x</option>)}
            </select>
            <select className="input" style={{width:92,padding:'8px 10px'}} value={quality} onChange={e=>{ setQuality(e.target.value); showToast?.('Quality selection unavailable for this source; using available stream') }}>
              {['auto'].map(q=><option key={q} value={q}>{q}</option>)}
            </select>
            <select className="input" style={{width:92,padding:'8px 10px'}} value={zoom} onChange={e=>setZoom(e.target.value)}>
              <option value="contain">Fit</option><option value="cover">Zoom</option><option value="fill">Stretch</option>
            </select>
            <select className="input" style={{width:110,padding:'8px 10px'}} value={fsMode} onChange={e=>setFsMode(e.target.value)}>
              <option value="auto">FS Auto</option><option value="landscape">FS Horizontal</option><option value="portrait">FS Vertical</option>
            </select>
            <button className="btn ghost" onClick={togglePiP}>PiP</button>
            <button className="btn ghost" onClick={()=>setShowInfo(v=>!v)}>Link</button>
            {activeJob ? <button className="btn ghost" onClick={()=>cancelDownload?.(activeJob.id)}>{activeJob.status==='queued'?'Queued…':'Downloading…'} {activeJob.progress||0}% • Cancel</button> : <button className="btn ghost" onClick={()=>{ if (item?.nativePath || item?.stored==='app-private' || item?.stored==='native-external') { import('../lib/export.js').then(m=>m.saveToPhone(item, downloadDir||'Download')).catch(()=>{}); showToast?.('Saved to device'); return } if(enqueueDownload) enqueueDownload(item); else window.open(item.downloadUrl||item.directUrl||item.src,'_blank') }}>{(item?.nativePath||item?.stored==='app-private'||item?.stored==='native-external')?'Save to phone':'Download'}</button>}
            {queue.length>1 && <button className="btn ghost" onClick={()=>setShowQueue(v=>!v)}>Queue</button>}
            {queue[idx-1] && <button className="btn ghost" onClick={()=>onSelect(queue[idx-1])}>Prev</button>}
            {queue[idx+1] && <button className="btn ghost" onClick={()=>onSelect(queue[idx+1])}>Next</button>}
          </div>
          <button className="btn ghost" onClick={toggleFs}>{fs?'Exit':'Fullscreen'}</button>
        </div>
      </div>}
    </div>}

    {showInfo && <div style={{position:'absolute',left:12,right:12,bottom:'max(96px,env(safe-area-inset-bottom))',background:'rgba(0,0,0,.95)',border:'1px solid #333',borderRadius:12,padding:12,pointerEvents:'auto',zIndex:20}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}><div style={{fontWeight:700}}>Video links</div><button className="iconbtn" onClick={()=>setShowInfo(false)}>✕</button></div>
      <div className="small" style={{wordBreak:'break-all',marginBottom:8}}><b>Source:</b> {item.sourceUrl || 'Local file'}</div>
      <div className="small" style={{wordBreak:'break-all',marginBottom:8}}><b>Stream:</b> {item.src || '-'}</div>
      <div className="row" style={{flexWrap:'wrap'}}>
        {item.sourceUrl && <button className="btn ghost" onClick={async()=>{try{await navigator.clipboard.writeText(item.sourceUrl); showToast?.('Source link copied')}catch{showToast?.('Copy failed')}}}>Copy source</button>}
        {item.src && <button className="btn ghost" onClick={async()=>{try{await navigator.clipboard.writeText(item.src); showToast?.('Stream link copied')}catch{showToast?.('Copy failed')}}}>Copy stream</button>}
        <button className="btn ghost" onClick={()=>{ if(enqueueDownload) enqueueDownload(item); else window.open(item.downloadUrl||item.directUrl||item.src,'_blank') }}>Download</button>
      </div>
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
