import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFileStorage } from '../src/infrastructure/storage/local-file.storage';

describe('LocalFileStorage', () => {
  it('refuses to overwrite an existing file through save', async () => {
    const root = await mkdtemp(join(tmpdir(), 'customer-storage-'));
    const storage = new LocalFileStorage(root);
    const key = 'clientes/identificaciones/701310975.jpg';
    const original = { buffer: Buffer.from('original'), mimetype: 'image/jpeg', size: 8 };
    const replacement = { buffer: Buffer.from('replacement'), mimetype: 'image/jpeg', size: 11 };

    try {
      await storage.save(original, key);

      await expect(storage.save(replacement, key)).rejects.toMatchObject({ code: 'EEXIST' });
      await expect(readFile(join(root, key))).resolves.toEqual(original.buffer);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
