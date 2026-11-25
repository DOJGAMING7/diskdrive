import '@testing-library/jest-dom'

if (!globalThis.localStorage || typeof globalThis.localStorage.clear !== 'function') {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (k) => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  }
}
if (!globalThis.sessionStorage || typeof globalThis.sessionStorage.clear !== 'function') {
  const store = new Map()
  globalThis.sessionStorage = {
    getItem: (k) => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  }
}
