import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TotersLokaliseClient } from '../src/client.js';
import { writeExport } from '../src/export-files.js';
import { readZip } from '../src/zip.js';

/** Minimal ZIP writer for tests (deflated entries, like the API). */
function zip(files: Record<string, string>): Uint8Array {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [path, text] of Object.entries(files)) {
    const name = Buffer.from(path);
    const data = deflateRawSync(Buffer.from(text));
    const size = Buffer.byteLength(text);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(size, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(size, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += 30 + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, directory, end]));
}

let folder = '';
afterEach(async () => {
  if (folder) await rm(folder, { recursive: true, force: true });
  folder = '';
});

describe('export files', () => {
  it('unpacks a ZIP into the output folder', async () => {
    folder = await mkdtemp(join(tmpdir(), 'lingo-export-'));
    const bytes = zip({ 'en.lproj/Localizable.strings': '"hi" = "Hi %@";\n', 'ar.lproj/Localizable.strings': '"hi" = "مرحبا %@";\n' });
    expect(readZip(bytes).map((entry) => entry.path)).toEqual(['en.lproj/Localizable.strings', 'ar.lproj/Localizable.strings']);
    const result = await writeExport({ bytes, contentType: 'application/zip', fileName: 'app.zip', warnings: '' }, 'Resources', folder);
    expect(result).toMatchObject({ outputDir: 'Resources', files: [{ path: join('Resources', 'en.lproj', 'Localizable.strings') }, {}] });
    expect(await readFile(join(folder, 'Resources', 'ar.lproj', 'Localizable.strings'), 'utf8')).toContain('مرحبا %@');
  });

  it('never writes outside the output folder', async () => {
    folder = await mkdtemp(join(tmpdir(), 'lingo-export-'));
    const bytes = zip({ '../evil.txt.strings': 'x' });
    await expect(writeExport({ bytes, contentType: 'application/zip', fileName: 'a.zip', warnings: '' }, 'out', folder)).rejects.toThrow(/outside the output folder/u);
  });

  it('returns text for review when no folder is given', async () => {
    const bytes = new TextEncoder().encode('<resources/>\n');
    const result = await writeExport({ bytes, contentType: 'application/xml', fileName: 'strings.xml', warnings: 'Android: a | b' });
    expect(result).toEqual({ exportFile: 'strings.xml', files: [{ path: 'strings.xml', bytes: 13, content: '<resources/>\n' }], warnings: ['Android: a', 'b'] });
  });

  it('posts export options to the public export endpoint and reads the file name', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Uint8Array([80, 75]), {
        headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="app.zip"; filename*=UTF-8''app-%C3%A9.zip` },
      }),
    );
    const client = new TotersLokaliseClient({ apiOrigin: 'https://example.test/toters-lokalise', accessKey: 'a', secret: 'b', fetch: request });
    const file = await client.postFile('projects/p1/exports', { format: 'apple-strings' });
    const [url, init] = request.mock.calls[0]!;
    expect(String(url)).toBe('https://example.test/toters-lokalise/api/v1/projects/p1/exports');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ format: 'apple-strings' });
    expect(file.fileName).toBe('app-é.zip');
  });

  it('reports a sign-in page instead of saving it', async () => {
    const client = new TotersLokaliseClient({
      apiOrigin: 'https://example.test',
      accessKey: 'a',
      secret: 'b',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } })),
    });
    await expect(client.postFile('projects/p1/exports', {})).rejects.toThrow(/sign-in page/u);
  });
});
