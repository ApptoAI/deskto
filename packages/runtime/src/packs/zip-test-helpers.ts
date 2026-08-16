import { writeFile } from "node:fs/promises"
import { deflateRawSync } from "node:zlib"

export type TestZipEntry = {
  compressed?: boolean
  content?: string | Buffer
  directory?: boolean
  name: string
  unixMode?: number
}

export async function writeTestZip(
  path: string,
  entries: TestZipEntry[]
): Promise<void> {
  const localRecords: Buffer[] = []
  const centralRecords: Buffer[] = []
  let localOffset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8")
    const content = entry.directory
      ? Buffer.alloc(0)
      : Buffer.isBuffer(entry.content)
        ? entry.content
        : Buffer.from(entry.content ?? "", "utf8")
    const compressedContent = entry.compressed
      ? deflateRawSync(content)
      : content
    const compressionMethod = entry.compressed ? 8 : 0
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0x0800, 6)
    localHeader.writeUInt16LE(compressionMethod, 8)
    localHeader.writeUInt32LE(crc32(content), 14)
    localHeader.writeUInt32LE(compressedContent.length, 18)
    localHeader.writeUInt32LE(content.length, 22)
    localHeader.writeUInt16LE(name.length, 26)
    const localRecord = Buffer.concat([localHeader, name, compressedContent])
    localRecords.push(localRecord)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(entry.unixMode === undefined ? 20 : 0x0314, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0x0800, 8)
    centralHeader.writeUInt16LE(compressionMethod, 10)
    centralHeader.writeUInt32LE(crc32(content), 16)
    centralHeader.writeUInt32LE(compressedContent.length, 20)
    centralHeader.writeUInt32LE(content.length, 24)
    centralHeader.writeUInt16LE(name.length, 28)
    if (entry.unixMode !== undefined)
      centralHeader.writeUInt32LE((entry.unixMode << 16) >>> 0, 38)
    centralHeader.writeUInt32LE(localOffset, 42)
    centralRecords.push(Buffer.concat([centralHeader, name]))
    localOffset += localRecord.length
  }

  const centralDirectory = Buffer.concat(centralRecords)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(localOffset, 16)
  await writeFile(path, Buffer.concat([...localRecords, centralDirectory, end]))
}

function crc32(content: Buffer): number {
  let checksum = 0xffffffff
  for (const byte of content) {
    checksum ^= byte
    for (let bit = 0; bit < 8; bit += 1)
      checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0)
  }
  return (checksum ^ 0xffffffff) >>> 0
}
