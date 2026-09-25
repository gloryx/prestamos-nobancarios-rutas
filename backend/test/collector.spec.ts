import { CollectorController } from '../src/presentation/collector/collector.controller';
import { CollectorUseCases, collectorPhotoKey, normalizeCollectorInput } from '../src/application/collector/collector.use-cases';
import type { CollectorRepository, CollectorCreate, CollectorListQuery, CollectorUpdate } from '../src/application/collector/collector.repository';
import type { Collector, EligibleCollectorUser } from '../src/domain/collector/collector.types';
import { CollectorIdentificationAlreadyExistsError, CollectorUnauthorizedAssociationError, CollectorUserNotEligibleError, CollectorValidationError } from '../src/domain/collector/collector.errors';
import type { FileStorage, UploadFile } from '../src/application/customer/file-storage';
import { CollectorTypeOrmRepository, mapCollector } from '../src/infrastructure/database/typeorm/repositories/collector.typeorm-repository';
import type { CollectorOrmEntity } from '../src/infrastructure/database/typeorm/entities/collector.orm-entity';
import type { UserOrmEntity } from '../src/infrastructure/database/typeorm/entities/user.orm-entity';
import type { Repository } from 'typeorm';

const id = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const makeCollector = (overrides: Partial<Collector> = {}): Collector => ({ id, identification: '1-2', firstName: 'ANA', firstLastName: 'PEREZ', phone: '8888', birthDate: '1990-01-01', address: 'SAN JOSE', photoFileKey: null, userId: null, isActive: true, createdAt: new Date(), updatedAt: new Date(), ...overrides });
class FakeStorage implements FileStorage { files = new Map<string, { buffer: Buffer; mimetype: string }>(); async save(file: UploadFile, key: string) { this.files.set(key, { buffer: file.buffer, mimetype: file.mimetype ?? 'image/png' }); } async replace(file: UploadFile, key: string) { return this.save(file, key); } async read(key: string) { const file = this.files.get(key); if (!file) throw new Error('missing'); return file; } async delete(key: string) { this.files.delete(key); } }
class FakeRepository implements CollectorRepository {
  rows: Collector[] = []; users: EligibleCollectorUser[] = [{ id: userId, fullName: 'Ana Pérez', username: 'ana' }];
  failUpdate = false;
  async list(query: CollectorListQuery) { const needle = query.search?.trim().toUpperCase(); const rows = this.rows.filter((row) => (query.status === 'ALL' || row.isActive === (query.status === 'ACTIVE')) && (!needle || `${row.identification} ${row.firstName} ${row.firstLastName} ${row.phone} ${row.address}`.toUpperCase().includes(needle))); return { items: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: rows.length }; }
  async findById(value: string) { return this.rows.find((row) => row.id === value) ?? null; }
  async identificationExists(value: string, exceptId?: string) { return this.rows.some((row) => row.identification.toLowerCase() === value.toLowerCase() && row.id !== exceptId); }
  async create(input: CollectorCreate) { const row = makeCollector({ ...input, isActive: true, photoFileKey: input.photoFileKey ?? null, userId: input.userId ?? null }); this.rows.push(row); return row; }
  async update(value: string, input: CollectorUpdate) { if (this.failUpdate) throw new Error('persistence'); const row = await this.findById(value); if (!row) return null; Object.assign(row, input); return row; }
  async updateStatus(value: string, isActive: boolean) { const row = await this.findById(value); if (!row) return null; row.isActive = isActive; return row; }
  async updateUser(value: string, linkedUserId: string | null) { const row = await this.findById(value); if (!row) return null; row.userId = linkedUserId; return row; }
  async findEligibleUser(value: string) { return this.users.find((user) => user.id === value) ?? null; }
  async userLinkedToAnother(value: string, collectorId: string) { return this.rows.some((row) => row.userId === value && row.id !== collectorId); }
  async listEligibleUsers() { return this.users.filter((user) => !this.rows.some((row) => row.userId === user.id)); }
}
const input = (extra: Record<string, unknown> = {}) => ({ identification: '  ab- 12 ', firstName: ' ana ', firstLastName: ' perez ', phone: ' 8888 ', birthDate: '1990-01-01', address: ' san jose ', ...extra });
const png = (): UploadFile => ({ buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), mimetype: 'image/png', size: 8 });

class ListQueryBuilder {
  private readonly conditions: Array<{ sql: string; parameters?: Record<string, unknown> }> = [];
  private offset = 0;
  private limit = 0;
  orderCalls: string[] = [];
  getManyAndCountCalls = 0;

  constructor(private readonly rows: CollectorOrmEntity[]) {}
  leftJoin() { return this; }
  addSelect() { return this; }
  orderBy(path: string) { if (path !== 'c.firstLastName') throw new Error(`Invalid order path: ${path}`); this.orderCalls.push(path); return this; }
  addOrderBy(path: string) { if (path !== 'c.firstName') throw new Error(`Invalid order path: ${path}`); this.orderCalls.push(path); return this; }
  andWhere(sql: string, parameters?: Record<string, unknown>) { this.conditions.push({ sql, parameters }); return this; }
  skip(value: number) { this.offset = value; return this; }
  take(value: number) { this.limit = value; return this; }
  async getManyAndCount(): Promise<[CollectorOrmEntity[], number]> {
    this.getManyAndCountCalls += 1;
    const active = this.conditions.find((condition) => condition.sql === 'c.is_active = :active')?.parameters?.active;
    const search = this.conditions.find((condition) => condition.parameters?.search)?.parameters?.search as string | undefined;
    const needle = search?.slice(1, -1).toUpperCase();
    const filtered = this.rows.filter((row) => (active === undefined || row.isActive === active) && (!needle || [row.identification, row.firstName, row.firstLastName, row.secondLastName ?? '', row.phone, row.alternativePhone ?? '', row.email ?? '', row.address].join(' ').toUpperCase().includes(needle)));
    const sorted = [...filtered].sort((left, right) => left.firstLastName.localeCompare(right.firstLastName) || left.firstName.localeCompare(right.firstName));
    return [sorted.slice(this.offset, this.offset + this.limit), filtered.length];
  }
}

const ormCollector = (overrides: Partial<CollectorOrmEntity> = {}): CollectorOrmEntity => ({ id, identification: '1-2', firstName: 'ANA', firstLastName: 'PEREZ', secondLastName: null, phone: '8888', alternativePhone: null, email: null, birthDate: '1990-01-01', address: 'SAN JOSE', photoFileKey: null, userId: null, user: null, isActive: true, createdAt: new Date(), updatedAt: new Date(), ...overrides });

describe('collector module', () => {
  it('normalizes authoritative text and optional blank fields', () => { expect(normalizeCollectorInput(input({ secondLastName: '  ', email: ' A@EXAMPLE.COM ' }))).toMatchObject({ identification: 'AB- 12', firstName: 'ANA', address: 'SAN JOSE', email: 'a@example.com' }); expect(normalizeCollectorInput(input({ alternativePhone: '   ' })).alternativePhone).toBeUndefined(); });
  it('rejects missing/future/date/photo validation', async () => { const useCases = new CollectorUseCases(new FakeRepository(), new FakeStorage()); await expect(useCases.create(input({ firstName: '  ' }), undefined, false)).rejects.toBeInstanceOf(CollectorValidationError); await expect(useCases.create(input({ birthDate: '2999-01-01' }), undefined, false)).rejects.toBeInstanceOf(CollectorValidationError); await expect(useCases.create(input(), { ...png(), buffer: Buffer.from('bad'), size: 3 }, false)).rejects.toBeInstanceOf(CollectorValidationError); });
  it('creates without a user and does not expose password data', async () => { const repository = new FakeRepository(); const created = await new CollectorUseCases(repository, new FakeStorage()).create(input(), undefined, false); expect(created.userId).toBeNull(); expect(created).not.toHaveProperty('passwordHash'); });
  it('maps only safe linked-user metadata for collector output', () => { const mapped = mapCollector({ ...makeCollector({ userId }), user: { id: userId, fullName: 'Ana Pérez', username: 'ana', passwordHash: 'secret' } } as never); expect(mapped.user).toEqual({ fullName: 'Ana Pérez', username: 'ana' }); expect(mapped.user).not.toHaveProperty('id'); expect(mapped.user).not.toHaveProperty('passwordHash'); });
  it('rejects duplicate identification and unauthorized association', async () => { const repository = new FakeRepository(); const useCases = new CollectorUseCases(repository, new FakeStorage()); await useCases.create(input(), undefined, false); await expect(useCases.create(input(), undefined, false)).rejects.toBeInstanceOf(CollectorIdentificationAlreadyExistsError); await expect(useCases.create(input({ identification: 'new', userId }), undefined, false)).rejects.toBeInstanceOf(CollectorUnauthorizedAssociationError); });
  it('links, unlinks, lists eligible users and rejects ineligible or duplicate users', async () => { const repository = new FakeRepository(); const useCases = new CollectorUseCases(repository, new FakeStorage()); const row = await useCases.create(input(), undefined, true); expect((await useCases.eligibleUsers())[0].id).toBe(userId); await useCases.linkUser(row.id, userId); expect((await useCases.eligibleUsers())).toHaveLength(0); const second = await useCases.create(input({ identification: 'second' }), undefined, true); await expect(useCases.linkUser(second.id, userId)).rejects.toThrow('ya está vinculado'); await useCases.linkUser(row.id, null); expect((await useCases.eligibleUsers())).toHaveLength(1); await expect(useCases.linkUser(row.id, '33333333-3333-4333-8333-333333333333')).rejects.toBeInstanceOf(CollectorUserNotEligibleError); });
  it('supports status/list/search semantics and optional photo retrieval', async () => { const repository = new FakeRepository(); const storage = new FakeStorage(); const useCases = new CollectorUseCases(repository, storage); const row = await useCases.create(input(), png(), false); const withoutPhoto = await useCases.create(input({ identification: 'second' }), undefined, false); expect(withoutPhoto.photoFileKey).toBeNull(); expect((await useCases.list({ status: 'ACTIVE', search: 'SAN JOSE', page: 1, pageSize: 10 })).total).toBe(2); await useCases.status(row.id, false); expect((await useCases.list({ status: 'ACTIVE', page: 1, pageSize: 10 })).total).toBe(1); expect((await useCases.photo(row.id)).mimetype).toBe('image/png'); });
  it('uses a deterministic safe photo key without changing the stored identification', async () => { const repository = new FakeRepository(); const storage = new FakeStorage(); const created = await new CollectorUseCases(repository, storage).create(input({ identification: ' ../unsafe/id ' }), png(), false); expect(created.identification).toBe('../UNSAFE/ID'); expect(created.photoFileKey).toBe('cobradores/fotos/___UNSAFE_ID.png'); expect(created.photoFileKey).toBe(collectorPhotoKey(created.identification, 'png')); expect(created.photoFileKey).not.toContain('..'); });
  it('replaces a photo safely and keeps the old file when persistence fails', async () => { const repository = new FakeRepository(); const storage = new FakeStorage(); const useCases = new CollectorUseCases(repository, storage); const created = await useCases.create(input(), png(), false); const key = created.photoFileKey as string; const oldBuffer = storage.files.get(key)?.buffer; repository.failUpdate = true; await expect(useCases.update(created.id, {}, png())).rejects.toThrow('persistence'); expect(storage.files.get(key)?.buffer).toEqual(oldBuffer); expect([...storage.files.keys()]).toEqual([key]); });
  it('lists collectors with metadata property ordering, pagination, search, and status filters', async () => {
    const rows = [ormCollector({ id: '1', firstName: 'ZOE', firstLastName: 'ALPHA', address: 'NORTH' }), ormCollector({ id: '2', firstName: 'ANA', firstLastName: 'BETA', isActive: false, address: 'SOUTH' }), ormCollector({ id: '3', firstName: 'BOB', firstLastName: 'BETA', address: 'NORTH' }), ...Array.from({ length: 9 }, (_, index) => ormCollector({ id: String(index + 4), firstName: 'NORTH', firstLastName: 'CETA', address: 'NORTH' }))];
    const builders: ListQueryBuilder[] = [];
    const repository = new CollectorTypeOrmRepository({ createQueryBuilder: () => { const builder = new ListQueryBuilder(rows); builders.push(builder); return builder; } } as unknown as Repository<CollectorOrmEntity>, {} as Repository<UserOrmEntity>);
    const defaultPage = await repository.list({ status: 'ALL', page: 1, pageSize: 10 });
    expect(defaultPage.total).toBe(12);
    expect(defaultPage.items.slice(0, 3).map((item) => item.id)).toEqual(['1', '2', '3']);
    expect(builders[0].orderCalls).toEqual(['c.firstLastName', 'c.firstName']);
    expect(builders[0].getManyAndCountCalls).toBe(1);
    const searchPage = await repository.list({ status: 'ALL', search: 'north', page: 2, pageSize: 10 });
    expect(searchPage).toMatchObject({ total: 11, items: [{ id: '12' }] });
    const active = await repository.list({ status: 'ACTIVE', page: 1, pageSize: 10 });
    expect(active.total).toBe(11);
    expect(active.items.slice(0, 2).map((item) => item.id)).toEqual(['1', '3']);
    const inactive = await repository.list({ status: 'INACTIVE', page: 1, pageSize: 10 });
    expect(inactive).toMatchObject({ total: 1, items: [{ id: '2' }] });
    expect(builders.every((builder) => builder.getManyAndCountCalls === 1)).toBe(true);
  });
  it('has no delete endpoint and exposes all required controller routes', () => { const names = Object.getOwnPropertyNames(CollectorController.prototype); expect(names).not.toContain('delete'); expect(names).toEqual(expect.arrayContaining(['eligibleUsers', 'list', 'detail', 'create', 'update', 'status', 'user', 'photo'])); });
});
