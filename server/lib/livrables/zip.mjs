/**
 * Archive ZIP minimale, sans dépendance.
 *   zipStore([{ name: 'a/b.txt', data: Buffer | string }], when?, { deflate? }) → Buffer
 *     méthode « store » par défaut ; deflate: true compresse les entrées qui y gagnent (zlib).
 *   readZip(buffer) → Map(nom → { size, read() → Buffer })   méthodes store et deflate
 * Utilisé pour les fichiers .docx, le modèle Word de l'entreprise et le pack de livrables.
 */
import zlib from 'zlib'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)
  const date = ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

export function zipStore(files, when = new Date(), { deflate = false } = {}) {
  const { time, date } = dosDateTime(when)
  const locals = []
  const centrals = []
  let offset = 0
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8')
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), 'utf8')
    const crc = crc32(data)
    let stored = data
    let method = 0
    if (deflate && data.length > 64) {
      const packed = zlib.deflateRawSync(data, { level: 6 })
      if (packed.length < data.length) {
        stored = packed
        method = 8
      }
    }

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version requise
    local.writeUInt16LE(0x0800, 6) // noms en UTF-8
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(stored.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, stored)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(stored.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + stored.length
  }
  const centralBuf = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBuf, end])
}

/**
 * Lit le répertoire central d'une archive ZIP (sans ZIP64 ni chiffrement).
 * Les entrées sont décompressées à la demande ; lève une Error si l'archive est illisible.
 */
export function readZip(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('Archive ZIP vide ou tronquée.')
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Archive ZIP illisible (répertoire central introuvable).')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const entries = new Map()
  for (let k = 0; k < count; k++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Archive ZIP illisible (entrée centrale invalide).')
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const size = buf.readUInt32LE(p + 24)
    const nlen = buf.readUInt16LE(p + 28)
    const xlen = buf.readUInt16LE(p + 30)
    const clen = buf.readUInt16LE(p + 32)
    const lho = buf.readUInt32LE(p + 42)
    const name = buf.toString(flags & 0x0800 ? 'utf8' : 'latin1', p + 46, p + 46 + nlen)
    p += 46 + nlen + xlen + clen
    if (name.endsWith('/')) continue
    if (flags & 0x0001) throw new Error(`Entrée chiffrée non prise en charge : ${name}`)
    if (method !== 0 && method !== 8) throw new Error(`Méthode de compression non prise en charge (${method}) : ${name}`)
    entries.set(name, {
      size,
      read() {
        if (lho + 30 > buf.length || buf.readUInt32LE(lho) !== 0x04034b50) throw new Error(`Entrée locale invalide : ${name}`)
        const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28)
        const raw = buf.subarray(start, start + csize)
        const data = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw)
        if (data.length !== size) throw new Error(`Taille inattendue pour ${name}`)
        return data
      },
    })
  }
  return entries
}
