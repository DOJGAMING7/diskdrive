import React, { useEffect, useState } from 'react'
import { checkAndUpdateBundle, getCachedBundleUrl, getBundleMeta } from '../lib/updater.js'

export default function BundleGate({ serverUrl, children }) {
  const [state, setState] = useState({ ready:false, status:'checking', meta:null, cachedUrl:null })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const meta = await getBundleMeta()
      const cachedUrl = await getCachedBundleUrl()
      if (!serverUrl?.trim()) {
        if (!cancelled) setState({ ready:true, status:'bundled', meta, cachedUrl:null })
        return
      }
      const res = await checkAndUpdateBundle(serverUrl)
      const nextMeta = res.meta || await getBundleMeta()
      const nextCached = await getCachedBundleUrl()
      if (cancelled) return
      if ((res.status === 'offline' || res.status === 'manifest-error' || res.status === 'bundle-error' || res.status === 'invalid-manifest' || res.status === 'invalid-bundle') && nextCached) {
        setState({ ready:true, status:'cached-fallback', meta: nextMeta, cachedUrl: nextCached, detail: res.status })
        return
      }
      if (res.status === 'updated' && nextCached) {
        setState({ ready:true, status:'updated', meta: nextMeta, cachedUrl: nextCached })
        return
      }
      setState({ ready:true, status: res.status, meta: nextMeta, cachedUrl: nextCached })
    })()
    return () => { cancelled = true }
  }, [serverUrl])

  if (!state.ready) return <div className="overlay"><div className="panel"><h2>DISKDRIVE</h2><p>Checking for updates…</p></div></div>
  if (state.cachedUrl && (state.status==='cached-fallback' || state.status==='updated')) {
    return <iframe title="DiskDrive UI" src={state.cachedUrl} style={{position:'fixed',inset:0,width:'100%',height:'100%',border:0,background:'#000'}} />
  }
  return children
}
