import { BlobWriter, BlobReader, ZipWriter } from '@zip.js/zip.js'

export async function makeZip(files, { password } = {}) {
  // files: [{name, blob}]
  const zipWriter = new ZipWriter(new BlobWriter('application/zip'), password ? { password, encryptionStrength: 3 } : undefined)
  for (const f of files) {
    await zipWriter.add(f.name, new BlobReader(f.blob), password ? { password, encryptionStrength: 3 } : undefined)
  }
  return await zipWriter.close()
}
