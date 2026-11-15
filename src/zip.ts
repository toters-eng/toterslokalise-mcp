import { inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  readonly path: string;
  readonly data: Buffer;
}

const MAX_ENTRIES = 5_000;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;

/** Read a ZIP produced by the export API (stored or deflated entries). */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const buffer = Buffer.from(bytes);
  let end = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65_557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new Error('The export is not a valid ZIP file');
  const count = buffer.readUInt16LE(end + 10);
  if (count > MAX_ENTRIES) throw new Error('The export ZIP has too many files');
  let offset = buffer.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('The export ZIP directory is damaged');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeader = buffer.readUInt32LE(offset + 42);
    const path = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    offset += 46 + nameLength + extraLength + commentLength;
    if (path.endsWith('/')) continue;
    total += size;
    if (total > MAX_TOTAL_BYTES) throw new Error('The export ZIP is too large to unpack');
    const dataStart =
      localHeader + 30 + buffer.readUInt16LE(localHeader + 26) + buffer.readUInt16LE(localHeader + 28);
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw) : null;
    if (!data) throw new Error(`The export ZIP uses an unsupported compression method (${method})`);
    entries.push({ path, data });
  }
  return entries;
}
