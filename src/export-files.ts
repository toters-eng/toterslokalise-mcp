import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { readZip, type ZipEntry } from './zip.js';

const PREVIEW_CHARS = 60_000;
const TEXT_EXTENSIONS = /\.(strings|stringsdict|xml|php|json|xcstrings|csv)$/iu;

export interface ExportedFile {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly fileName: string;
  readonly warnings: string;
}

/** Keep every written path inside the chosen folder (no "..", no absolute paths). */
function safeTarget(root: string, path: string): string {
  const target = resolve(root, path);
  const inside = relative(root, target);
  if (!inside || inside.startsWith('..') || isAbsolute(inside) || inside.split(sep).includes('..')) {
    throw new Error(`Refusing to write outside the output folder: ${path}`);
  }
  return target;
}

/**
 * Write the export into outputDir (unpacking ZIPs), or, without outputDir,
 * return the text files so the assistant can review them first.
 */
export async function writeExport(file: ExportedFile, outputDir?: string, cwd = process.cwd()) {
  const zipped = file.contentType.includes('zip') || file.fileName.toLowerCase().endsWith('.zip');
  const entries: ZipEntry[] = zipped ? readZip(file.bytes) : [{ path: file.fileName, data: Buffer.from(file.bytes) }];
  const warnings = file.warnings ? file.warnings.split(' | ').filter(Boolean) : [];

  if (outputDir) {
    const root = resolve(cwd, outputDir);
    const written: Array<{ path: string; bytes: number }> = [];
    for (const entry of entries) {
      const target = safeTarget(root, entry.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, entry.data);
      written.push({ path: relative(cwd, target) || entry.path, bytes: entry.data.length });
    }
    return { outputDir: relative(cwd, root) || '.', files: written, warnings };
  }

  let budget = PREVIEW_CHARS;
  const files = entries.map((entry) => {
    if (!TEXT_EXTENSIONS.test(entry.path)) {
      return { path: entry.path, bytes: entry.data.length, content: null, note: 'Binary file: pass outputDir to save it.' };
    }
    const text = entry.data.toString('utf8');
    const shown = text.slice(0, Math.max(0, budget));
    budget -= shown.length;
    return {
      path: entry.path,
      bytes: entry.data.length,
      content: shown,
      ...(shown.length < text.length ? { note: 'Cut short; pass outputDir to save the full file.' } : {}),
    };
  });
  return { exportFile: file.fileName, files, warnings };
}
