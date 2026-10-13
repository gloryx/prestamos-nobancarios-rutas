import 'reflect-metadata';
import type { DataSource } from 'typeorm';
import { DailyCollectionsForbiddenError, DailyCollectionsUseCase, DailyCollectionsValidationError, type DailyCollectionsReader } from '../src/application/payment/daily-collections.use-case';
import { DailyCollectionsTypeormReader } from '../src/infrastructure/database/typeorm/repositories/daily-collections.reader';
import { PaymentController } from '../src/presentation/payment/payment.controller';
import { PERMISSIONS_KEY } from '../src/presentation/security/security.decorators';

const date = '2026-10-06';
const identity = { id: 'collector-user', username: 'collector', fullName: 'Collector', sessionId: 'session', permissions: ['daily-collections.assigned.view'], role: { id: 'role', code: 'COLLECTOR', name: 'Collector', isSuperAdmin: false } };

describe('assigned daily collections scope', () => {
  it('scopes summary, search and pagination through the authenticated active collector', async () => {
    const reader = { resolveCollector: jest.fn(async (_userId: string) => ({ collectorId: 'collector-profile', collectorUserId: 'collector-user' })),
      summary: jest.fn(async (_date: string) => ({ dueCount: 0, dueAmount: '0.00', paidLoansCount: 0, receivedAmount: '0.00' })),
      due: jest.fn(async (query) => ({ items: [], total: 0, page: query.page, pageSize: query.pageSize })),
      received: jest.fn(async (query) => ({ items: [], total: 0, page: query.page, pageSize: query.pageSize })) } as unknown as jest.Mocked<DailyCollectionsReader>;
    const useCase = new DailyCollectionsUseCase(reader, () => new Date('2026-10-06T12:00:00-06:00'));
    await useCase.assignedSummary(date, identity);
    await useCase.assignedDue({ date, search: ' Ana ', page: 2, pageSize: 20 }, identity);
    expect(reader.summary).toHaveBeenCalledWith(date, { kind: 'COLLECTOR', collectorId: 'collector-profile', collectorUserId: 'collector-user' });
    expect(reader.due).toHaveBeenCalledWith(expect.objectContaining({ search: 'Ana', page: 2 }), { kind: 'COLLECTOR', collectorId: 'collector-profile', collectorUserId: 'collector-user' });
  });

  it('returns 403 semantics for invalid/inactive/unlinked collectors', async () => {
    const reader = { resolveCollector: jest.fn(async (_userId: string) => null), summary: jest.fn(), due: jest.fn(), received: jest.fn() } as unknown as DailyCollectionsReader;
    await expect(new DailyCollectionsUseCase(reader, () => new Date('2026-10-06T12:00:00-06:00')).assignedSummary(date, identity)).rejects.toBeInstanceOf(DailyCollectionsForbiddenError);
  });

  it('places current assignment scope in due, received and summary SQL', async () => {
    const calls: string[] = [];
    const query = jest.fn(async (sql: string, _params: unknown[] = []) => { calls.push(sql); if (sql.includes('"dueCount"')) return [{ dueCount: 0, dueAmount: '0.00', paidLoansCount: 0, receivedAmount: '0.00' }]; if (sql.includes('COUNT(*)')) return [{ total: 0 }]; return []; });
    const source = { query, transaction: jest.fn(async (_level: string, run: (manager: { query: typeof query }) => unknown) => run({ query })) };
    const reader = new DailyCollectionsTypeormReader(source as unknown as DataSource);
    const scope = { kind: 'COLLECTOR' as const, collectorId: 'collector-profile', collectorUserId: 'collector-user' };
    await reader.summary(date, scope); await reader.due({ date, search: 'Ana', page: 1, pageSize: 20, sortBy: 'customer', sortDir: 'asc' }, scope);
    await reader.received({ date, search: 'Ana', page: 1, pageSize: 20, sortBy: 'customer', sortDir: 'asc' }, scope);
    expect(query.mock.calls[0][1]).toEqual([date, 'collector-user', 'collector-profile']);
    const scopedSearches = query.mock.calls.filter(([sql]) => sql.includes('ILIKE'));
    expect(scopedSearches).not.toHaveLength(0);
    for (const [sql, params] of scopedSearches) {
      expect(sql).toContain('ILIKE $3');
      expect(params?.slice(0, 3)).toEqual(expect.arrayContaining([date, '%Ana%']));
      expect(params![2]).toBe('%Ana%');
    }
    for (const sql of calls.filter((sql) => !sql.includes('FROM payments p'))) {
      expect(sql).toContain('scra.ended_at IS NULL');
      expect(sql).toContain('sca.ended_at IS NULL');
      expect(sql).toContain('srte.is_active=true');
    }
    const receivedSql = calls.filter((sql) => sql.includes('FROM payments p') && !sql.includes('SELECT due."dueCount"'));
    expect(receivedSql).not.toHaveLength(0);
    for (const sql of receivedSql) {
      expect(sql).toContain('p.collector_id=');
      expect(sql).not.toContain('customer_route_assignments');
    }
  });

  it('keeps historical received payments scoped by persisted collector attribution', async () => {
    const reader = { resolveCollector: jest.fn(async () => ({ collectorId: 'collector-profile', collectorUserId: 'collector-user' })),
      summary: jest.fn(), due: jest.fn(),
      received: jest.fn(async (query) => ({ items: [], total: 0, page: query.page, pageSize: query.pageSize })) } as unknown as jest.Mocked<DailyCollectionsReader>;
    const useCase = new DailyCollectionsUseCase(reader, () => new Date('2026-10-06T12:00:00-06:00'));
    await useCase.assignedReceived({ date: '2026-10-01' }, identity);
    expect(reader.received).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-10-01' }),
      { kind: 'COLLECTOR', collectorId: 'collector-profile', collectorUserId: 'collector-user' });
    await expect(useCase.assignedReceived({ date: '2026-10-07' }, identity)).rejects.toBeInstanceOf(DailyCollectionsValidationError);
  });

  it('keeps the centralized superadmin bypass global without resolving a collector profile', async () => {
    const reader = { resolveCollector: jest.fn(), summary: jest.fn(async () => ({ dueCount: 0, dueAmount: '0.00', paidLoansCount: 0, receivedAmount: '0.00' })),
      due: jest.fn(), received: jest.fn() } as unknown as jest.Mocked<DailyCollectionsReader>;
    const useCase = new DailyCollectionsUseCase(reader, () => new Date('2026-10-06T12:00:00-06:00'));
    await useCase.assignedSummary(date, { ...identity, role: { ...identity.role, code: 'ADMIN', isSuperAdmin: true } });
    expect(reader.resolveCollector).not.toHaveBeenCalled();
    expect(reader.summary).toHaveBeenCalledWith(date, { kind: 'ALL' });
  });

  it('uses a dedicated permission without changing administrative daily collections', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, PaymentController.prototype.assignedDailySummary)).toEqual(['daily-collections.assigned.view']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, PaymentController.prototype.assignedDailyDue)).toEqual(['daily-collections.assigned.view']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, PaymentController.prototype.assignedDailyReceived)).toEqual(['daily-collections.assigned.view']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, PaymentController.prototype.dailySummary)).toEqual(['payments.view']);
  });
});
