import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { StatusBar, Style } from '@capacitor/status-bar'

export const isNative = () => Capacitor.isNativePlatform()
export async function initNative() {
  if (!isNative()) return
  try { await StatusBar.setStyle({ style: Style.Dark }); await StatusBar.setBackgroundColor({ color: '#000000' }) } catch {}
}
export function onAppState(cb) {
  if (!isNative()) {
    const vis = () => cb({ isActive: document.visibilityState === 'visible' })
    document.addEventListener('visibilitychange', vis)
    window.addEventListener('blur', () => cb({ isActive:false }))
    window.addEventListener('focus', () => cb({ isActive:true }))
    return () => { document.removeEventListener('visibilitychange', vis) }
  }
  let h
  CapApp.addListener('appStateChange', cb).then(x => h=x)
  return () => { try { h?.remove() } catch {} }
}
export async function exitApp() { if (isNative()) try { await CapApp.exitApp() } catch {} }
