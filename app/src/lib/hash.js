export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}
export async function verifyHash(text, hash) {
  if (!hash) return false
  return (await sha256(text)) === String(hash).toLowerCase()
}
