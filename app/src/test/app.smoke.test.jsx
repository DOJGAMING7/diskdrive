import React from 'react'
import { render, screen } from '@testing-library/react'
import { vi, test, expect, beforeEach } from 'vitest'

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false, convertFileSrc: (x)=>x } }))
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(async()=>({ remove: vi.fn() })), exitApp: vi.fn() } }))
vi.mock('@capacitor/status-bar', () => ({ StatusBar: { setStyle: vi.fn(), setBackgroundColor: vi.fn(), setOverlaysWebView: vi.fn() }, Style: { Dark:'DARK' } }))
vi.mock('@capacitor/preferences', () => ({ Preferences: { get: vi.fn(async()=>({ value:null })), set: vi.fn(async()=>{}), remove: vi.fn(async()=>{}) } }))
vi.mock('@capacitor/filesystem', () => ({ Filesystem: { mkdir: vi.fn(), writeFile: vi.fn(), getUri: vi.fn(async()=>({ uri:'file:///tmp/x' })), stat: vi.fn(), readdir: vi.fn(async()=>({files:[]})), readFile: vi.fn(async()=>({data:''})), deleteFile: vi.fn(), rmdir: vi.fn() }, Directory: { Data:'DATA', Documents:'DOCUMENTS', Cache:'CACHE' } }))
vi.mock('@capacitor/share', () => ({ Share: { share: vi.fn() } }))

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

test('app mounts with empty storage and shows admin gate', async () => {
  const { default: App } = await import('../App.jsx')
  render(<App />)
  expect(await screen.findByText(/Admin Access/i)).toBeInTheDocument()
})
