import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, normalize, resolve } from 'node:path';
import type { FileStorage, UploadFile } from '../../application/customer/file-storage';

export class LocalFileStorage implements FileStorage {
  constructor(private readonly root = resolve(process.cwd().toLowerCase().endsWith('backend') ? process.cwd() : resolve(process.cwd(), 'backend'), 'uploads')) {}
  private path(key: string): string { const clean = key.replace(/\\/g, '/'); const target = resolve(this.root, clean); if (isAbsolute(clean) || (target !== this.root && !target.startsWith(`${this.root}/`) && !target.startsWith(`${this.root}\\`))) throw new Error('Invalid storage key.'); return normalize(target); }
  async save(file: UploadFile, relativeKey: string): Promise<void> { const path = this.path(relativeKey); await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, file.buffer, { flag: 'wx' }); }
  async read(relativeKey: string): Promise<{ buffer: Buffer; mimetype: string }> {
    const path = this.path(relativeKey);
    const buffer = await readFile(path);
    const extension = path.split('.').pop()?.toLowerCase();
    const mimetype = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
    return { buffer, mimetype };
  }
  async replace(file: UploadFile, relativeKey: string): Promise<void> { const path = this.path(relativeKey); await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, file.buffer); }
  async delete(relativeKey: string): Promise<void> { try { await unlink(this.path(relativeKey)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
}
