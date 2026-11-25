# DiskDrive

Private Android testing app (Plan 1). Capacitor + React/Vite.

## Plan 1 scope
- Real Android app shell (no TWA).
- Local video playback only.
- Terabox/DiskWala buttons and paste UI visible, but show Coming soon.
- Home, Download, History, Playlist, Settings.
- Native-oriented player: play/pause, 10s seek, seek bar, speed, PiP, hold-to-2x, fullscreen, next/prev, lock UI.
- App-private local import, history, playlists, settings, admin gate, PIN lock.

## Dev
```bash
npm install
npm run build
npx cap sync android
```

## Android APK (GitHub Actions)
Push to `main` or run workflow manually. Artifact: `DISKDRIVE-V1.apk`.
