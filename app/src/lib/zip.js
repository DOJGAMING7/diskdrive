function u16(n){ return [n & 255, (n>>8)&255] }
function u32(n){ return [n&255,(n>>8)&255,(n>>16)&255,(n>>24)&255] }
function strBytes(s){ return [...new TextEncoder().encode(s)] }
function crc32(buf){
  let c = ~0>>>0
  for (let i=0;i<buf.length;i++){
    c ^= buf[i]
    for (let j=0;j<8;j++) c = (c>>>1) ^ (0xEDB88320 & -(c&1))
  }
  return (~c)>>>0
}

export async function makeZip(files) {
  // files: [{name, blob}]
  const entries = []
  let offset = 0
  const chunks = []
  for (const f of files) {
    const nameBytes = strBytes(f.name)
    const data = new Uint8Array(await f.blob.arrayBuffer())
    const crc = crc32(data)
    const local = [ ...strBytes('PK\x03\x04'), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0), ...nameBytes ]
    chunks.push(new Uint8Array(local), data)
    entries.push({ nameBytes, crc, size: data.length, offset })
    offset += local.length + data.length
  }
  const cdStart = offset
  for (const e of entries) {
    const cd = [ ...strBytes('PK\x01\x02'), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(e.crc), ...u32(e.size), ...u32(e.size), ...u16(e.nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(e.offset), ...e.nameBytes ]
    chunks.push(new Uint8Array(cd))
    offset += cd.length
  }
  const cdSize = offset - cdStart
  const eocd = [ ...strBytes('PK\x05\x06'), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length), ...u32(cdSize), ...u32(cdStart), ...u16(0) ]
  chunks.push(new Uint8Array(eocd))
  return new Blob(chunks, { type: 'application/zip' })
}
