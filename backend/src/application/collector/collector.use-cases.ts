import { randomUUID } from 'node:crypto';
import { CollectorIdentificationAlreadyExistsError, CollectorNotFoundError, CollectorUnauthorizedAssociationError, CollectorUserAlreadyLinkedError, CollectorUserNotEligibleError, CollectorValidationError } from '../../domain/collector/collector.errors';
import type { Collector, EligibleCollectorUser } from '../../domain/collector/collector.types';
import type { UploadFile, FileStorage } from '../customer/file-storage';
import type { CollectorCreate, CollectorListQuery, CollectorRepository, CollectorUpdate } from './collector.repository';

const optionalText = (value: unknown, upper = true): string | undefined => { if (value === undefined || value === null) return undefined; const text = String(value).trim(); return text ? (upper ? text.toUpperCase() : text) : undefined; };
const requiredText = (value: unknown, label: string, upper = true): string => { const result = optionalText(value, upper); if (!result) throw new CollectorValidationError(`${label} es requerido.`); return result; };
export const normalizeCollectorInput = (input: Record<string, unknown>, partial = false): Record<string, unknown> => {
  const output: Record<string, unknown> = {};
  const fields: [string, boolean, string][] = [['identification', true, 'La identificación'], ['firstName', true, 'El nombre'], ['firstLastName', true, 'El primer apellido'], ['phone', true, 'El teléfono'], ['birthDate', false, 'La fecha de nacimiento'], ['address', true, 'La dirección']];
  for (const [field, upper, label] of fields) { if (partial && input[field] === undefined) continue; output[field] = requiredText(input[field], label, upper); }
  for (const [field, upper] of [['secondLastName', true], ['alternativePhone', true]] as const) { if (input[field] !== undefined) output[field] = optionalText(input[field], upper); }
  if (input.email !== undefined) { const email = optionalText(input.email, false); output.email = email?.toLowerCase(); }
  if (!partial || input.birthDate !== undefined) { const date = String(output.birthDate); const parsed = new Date(`${date}T00:00:00Z`); const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date; if (!validDate) throw new CollectorValidationError('La fecha de nacimiento no es válida.'); if (date > new Date().toISOString().slice(0, 10)) throw new CollectorValidationError('La fecha de nacimiento no puede ser futura.'); }
  if (output.email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(output.email))) throw new CollectorValidationError('El correo electrónico no es válido.');
  return output;
};
const extension = (file: UploadFile): string => { const b = file.buffer; if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'; if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png'; if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp'; throw new CollectorValidationError('La fotografía debe ser JPEG, PNG o WEBP válida.'); };
const validatePhoto = (file?: UploadFile): string | undefined => { if (!file) return undefined; if (file.size > 5 * 1024 * 1024) throw new CollectorValidationError('La fotografía no puede superar 5 MB.'); return extension(file); };
const safeFilenameIdentification = (identification: string): string => { const safe = identification.replace(/[^A-Za-z0-9_-]/g, '_').replace(/^\.+/, '').slice(0, 80); return safe || 'identification'; };
const extensionFromKey = (key: string): string => { const value = key.split('.').pop()?.toLowerCase(); return value === 'png' || value === 'webp' || value === 'jpg' || value === 'jpeg' ? value : 'jpg'; };
export const collectorPhotoKey = (identification: string, fileOrExtension: UploadFile | string): string => `cobradores/fotos/${safeFilenameIdentification(identification)}.${typeof fileOrExtension === 'string' ? fileOrExtension : extension(fileOrExtension)}`;

export class CollectorUseCases {
  constructor(private readonly repository: CollectorRepository, private readonly storage: FileStorage) {}
  async list(query: CollectorListQuery) { const result = await this.repository.list(query); return { ...result, pages: Math.ceil(result.total / query.pageSize) }; }
  async detail(id: string) { const item = await this.repository.findById(id); if (!item) throw new CollectorNotFoundError(); return item; }
  async eligibleUsers(): Promise<EligibleCollectorUser[]> { return this.repository.listEligibleUsers(); }
  async create(input: Record<string, unknown>, photo: UploadFile | undefined, canAssignUser: boolean): Promise<Collector> {
    const normalized = normalizeCollectorInput(input);
    const userId = optionalText(input.userId, false) ?? null;
    if (userId && !canAssignUser) throw new CollectorUnauthorizedAssociationError();
    if (userId) await this.validateUser(userId, '');
    if (await this.repository.identificationExists(String(normalized.identification))) throw new CollectorIdentificationAlreadyExistsError();
    const photoExtension = validatePhoto(photo); const id = randomUUID(); const photoFileKey = photoExtension ? collectorPhotoKey(String(normalized.identification), photoExtension) : null;
    let photoStored = false;
    try {
      if (photo && photoFileKey) { await this.storage.save(photo, photoFileKey); photoStored = true; }
      return await this.repository.create({ id, ...normalized, photoFileKey, userId } as CollectorCreate);
    } catch (error) {
      if (photoStored && photoFileKey) await Promise.allSettled([this.storage.delete(photoFileKey)]);
      throw error;
    }
  }
  async update(id: string, input: Record<string, unknown>, photo?: UploadFile): Promise<Collector> {
    const current = await this.detail(id); const normalized = normalizeCollectorInput(input, true) as CollectorUpdate; const photoExtension = validatePhoto(photo);
    if (normalized.identification && await this.repository.identificationExists(normalized.identification, id)) throw new CollectorIdentificationAlreadyExistsError();
    const identification = String(normalized.identification ?? current.identification);
    const targetKey = photoExtension ? collectorPhotoKey(identification, photoExtension) : current.photoFileKey && normalized.identification ? collectorPhotoKey(identification, extensionFromKey(current.photoFileKey)) : current.photoFileKey;
    const writtenKeys: string[] = [];
    const stagingKeys: string[] = [];
    let committed = false;
    let stagedReplacement: { file: UploadFile; key: string } | undefined;
    try {
      if (photo && photoExtension && targetKey) {
        if (targetKey === current.photoFileKey) {
          const stagingKey = `cobradores/.staging/${randomUUID()}.${photoExtension}`;
          await this.storage.save(photo, stagingKey); stagingKeys.push(stagingKey); stagedReplacement = { file: photo, key: targetKey };
        } else { await this.storage.save(photo, targetKey); writtenKeys.push(targetKey); }
        normalized.photoFileKey = targetKey;
      } else if (!photo && current.photoFileKey && targetKey && targetKey !== current.photoFileKey) {
        const old = await this.storage.read(current.photoFileKey);
        await this.storage.save({ buffer: old.buffer, mimetype: old.mimetype, size: old.buffer.length }, targetKey);
        writtenKeys.push(targetKey); normalized.photoFileKey = targetKey;
      }
      const updated = await this.repository.update(id, normalized); if (!updated) throw new CollectorNotFoundError();
      committed = true;
      if (stagedReplacement) await this.storage.replace(stagedReplacement.file, stagedReplacement.key);
      if (current.photoFileKey && normalized.photoFileKey && current.photoFileKey !== normalized.photoFileKey) await Promise.allSettled([this.storage.delete(current.photoFileKey)]);
      await Promise.allSettled(stagingKeys.map((key) => this.storage.delete(key)));
      return updated;
    } catch (error) {
      if (!committed) await Promise.allSettled(writtenKeys.map((key) => this.storage.delete(key)));
      await Promise.allSettled(stagingKeys.map((key) => this.storage.delete(key)));
      throw error;
    }
  }
  async status(id: string, isActive: boolean) { const item = await this.repository.updateStatus(id, isActive); if (!item) throw new CollectorNotFoundError(); return item; }
  async linkUser(id: string, userId: string | null) { await this.detail(id); if (userId !== null) { await this.validateUser(userId, id); if (await this.repository.userLinkedToAnother(userId, id)) throw new CollectorUserAlreadyLinkedError(); } const item = await this.repository.updateUser(id, userId); if (!item) throw new CollectorNotFoundError(); return item; }
  async photo(id: string) { const item = await this.detail(id); if (!item.photoFileKey) throw new CollectorValidationError('El cobrador no tiene fotografía.'); return this.storage.read(item.photoFileKey); }
  private async validateUser(userId: string, collectorId: string) { const user = await this.repository.findEligibleUser(userId); if (!user) throw new CollectorUserNotEligibleError(); if (await this.repository.userLinkedToAnother(userId, collectorId)) throw new CollectorUserAlreadyLinkedError(); }
}
