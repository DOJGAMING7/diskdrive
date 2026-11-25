import { getPref, setPref, KEYS } from './storage.js'
import { uid, now } from './id.js'

const DEFAULT_SETTINGS = {
  lockDelaySec: 15,
  pinEnabled: false,
  lastSaveDir: null,
  serverUrl: '',
  resolverUrl: '',
  resolverKey: '',
}
const DEFAULT_PLAYLISTS = [
  { id: 'watch-later', name: 'WATCH LATER', builtIn: true, items: [], updatedAt: now() },
  { id: 'favourites', name: 'FAVOURITES', builtIn: true, items: [], updatedAt: now() },
]

export async function loadState() {
  const [adminUnlocked, adminHash, pinHash, pinEnabled, lockDelay, history, playlists, downloads, settings] = await Promise.all([
    getPref(KEYS.adminUnlocked, false),
    getPref(KEYS.adminHash, null),
    getPref(KEYS.pinHash, null),
    getPref(KEYS.pinEnabled, false),
    getPref(KEYS.lockDelay, 15),
    getPref(KEYS.history, []),
    getPref(KEYS.playlists, DEFAULT_PLAYLISTS),
    getPref(KEYS.downloads, []),
    getPref(KEYS.settings, DEFAULT_SETTINGS),
  ])
  return {
    adminUnlocked: !!adminUnlocked,
    adminHash,
    pinHash,
    pinEnabled: !!pinEnabled,
    lockDelay: Number(lockDelay || 15),
    history: Array.isArray(history) ? history : [],
    playlists: Array.isArray(playlists) && playlists.length ? playlists : DEFAULT_PLAYLISTS,
    downloads: Array.isArray(downloads) ? downloads : [],
    settings: { ...DEFAULT_SETTINGS, ...(settings || {}) },
  }
}

export const persist = {
  adminUnlocked: v => setPref(KEYS.adminUnlocked, v),
  adminHash: v => setPref(KEYS.adminHash, v),
  pinHash: v => setPref(KEYS.pinHash, v),
  pinEnabled: v => setPref(KEYS.pinEnabled, v),
  lockDelay: v => setPref(KEYS.lockDelay, v),
  history: v => setPref(KEYS.history, v),
  playlists: v => setPref(KEYS.playlists, v),
  downloads: v => setPref(KEYS.downloads, v),
  settings: v => setPref(KEYS.settings, v),
}

export function fileToMedia(file, provider='LOCAL') {
  const url = URL.createObjectURL(file)
  return {
    id: uid(), provider, kind: 'local', name: file.name, title: file.name.replace(/\.[^.]+$/, ''),
    src: url, fileName: file.name, size: file.size || 0, type: file.type || '', addedAt: now(),
    duration: 0, thumbnail: '', position: 0, watchCount: 0, lastWatchedAt: null,
  }
}
export function fmtBytes(bytes=0){ if(!bytes) return '0 B'; const u=['B','KB','MB','GB','TB']; const i=Math.min(Math.floor(Math.log(bytes)/Math.log(1024)),u.length-1); return `${(bytes/Math.pow(1024,i)).toFixed(i?1:0)} ${u[i]}` }
export function fmtTime(sec=0){ sec=Math.max(0,Math.floor(sec)); const h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60), s=sec%60; return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}` }
