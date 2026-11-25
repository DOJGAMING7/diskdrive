import { Preferences } from '@capacitor/preferences'

const isNative = () => !!window.Capacitor?.isNativePlatform?.()

export async function getPref(key, fallback = null) {
  try {
    if (isNative()) {
      const { value } = await Preferences.get({ key })
      return value == null ? fallback : JSON.parse(value)
    }
    const v = localStorage.getItem(key)
    return v == null ? fallback : JSON.parse(v)
  } catch { return fallback }
}
export async function setPref(key, value) {
  const v = JSON.stringify(value)
  if (isNative()) return Preferences.set({ key, value: v })
  localStorage.setItem(key, v)
}
export async function removePref(key) {
  if (isNative()) return Preferences.remove({ key })
  localStorage.removeItem(key)
}

export const KEYS = {
  adminUnlocked: 'dd_admin_unlocked',
  adminHash: 'dd_admin_hash',
  pinHash: 'dd_pin_hash',
  pinEnabled: 'dd_pin_enabled',
  lockDelay: 'dd_lock_delay',
  history: 'dd_history',
  playlists: 'dd_playlists',
  downloads: 'dd_downloads',
  settings: 'dd_settings',
  uiBundleMeta: 'dd_ui_bundle_meta',
  uiBundleCache: 'dd_ui_bundle_cache',
}
