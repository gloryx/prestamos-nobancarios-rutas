import 'reflect-metadata';
import type { DataSource } from 'typeorm';
import { DailyCollectionsForbiddenError, DailyCollectionsUseCase, type DailyCollectionsReader } from '../src/application/payment/daily-collections.use-case';
import { DailyCollectionsTypeormReader } from '../src/infrastructure/database/typeorm/repositories/daily-collections.reader';
import { PaymentController } from '../src/presentation/payment/payment.controller';
import { PERMISSIONS_KEY } from '../src/presentation/security/security.decorators';

const date = '2026-10-06';
const identity = { id: 'collector-user', username: 'collector', fullName: 'Collector', sessionId: 'session', permissions: ['daily-collections.assigned.view'], role: { id: 'role', code: 'COLLECTOR', name: 'Collector', isSuperAdmin: false } };

describe('assigned daily collections scope', () => {
  it('scopes summary, search and pagination through the authenticated active collector', async () => {
    const reader = { resolveCollector: jest.fn(async (_userId: string) => true),
      summary: jest.fn(async (_date: string) => ({ dueCount: 0, dueAmount: '0.00', paidLoansCount: 0, receivedAmount: '0.00' })),
      due: jest.fn(async (query) => ({ items: [], total: 0, page: query.page, pageSize: query.pageSize })),
      received: jest.fn(async (query) => ({ items: [], total: 0, page: query.page, pageSize: query.pageSize })) } as unknown as jest.Mocked<DailyCollectionsReader>;
    const useCase = new DailyCollectionsUseCase(reader, () => new Date('2026-10-06T12:00:00-06:00'));
    await useCase.assignedSummary(date, identity);
    await useCase.assignedDue({ date, search: ' Ana ', page: 2, pageSize: 20 }, identity);
    expect(reader.summary).toHaveBeenCalledWith(date, { kind: 'COLLECTOR', collectorUserId: 'collector-user' });
    expect(reader.due).toHaveBeenCalledWith(expect.objectContaining({ search: 'Ana', page: 2 }), { kind: 'COLLECTOR', collectorUserId: 'collector-user' });
  });

  it('returns 403 semantics for invalid/inactive/unlinked collectors', async () => {
    const reader = { resolveCollector: jest.fn(async (_userId: string) => false), summary: jest.fn(), due: jest.fn(), received: jest.fn() } as unknown as DailyCollectionsReader;
    await expect(new DailyCollectionsUseCase(reader, () => new Date('2026-10-06T12:00:00-06:00')).assignedSummary(date, identity)).rejects.toBeInstanceOf(DailyCollectionsForbiddenError);
  });

  it('places current assignment scope in due, received and summary SQL', async () => {
    const calls: string[] = [];
    const query = jest.fn(async (sql: string) => { calls.push(sql); if (sql.includes('"dueCount"')) return [{ dueCount: 0, dueAmount: '0.00', paidLoansCount: 0, receivedAmount: '0.00' }]; if (sql.includes('COUNT(*)')) return [{ total: 0 }]; return []; });
    const source = { query, transaction: jest.fn(async (_level: string, run: (manager: { query: typeof query }) => unknown) => run({ query })) };
    const reader = new DailyCollectionsTypeormReader(source as unknown as DataSource);
    const scope = { kind: 'COLLECTOR' as const, collectorUserId: 'collector-user' };
    await reader.summary(date, scope); await reader.due({ date, search: 'Ana', page: 1, pageSize: 20, sortBy: 'customer', sortDir: 'asc' }, scope);
    await reader.received({ date, page: 1, pageSize: 20, sortBy: 'customer', sortDir: 'asc' }, scope);
    for (const sql of calls) {
      expect(sql).toContain('scra.ended_at IS NULL');
      expect(sql).toContain('sca.ended_at IS NULL');
      expect(sql).toContain('srte.is_active=true');
    }
  });

  it('uses a dedicated permission without changing administrative daily collections', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, PaymentController.prototype.assignedDailySummary)).toEqual(['daily-collections.assigned.view']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, PaymentController.prototype.assignedDailyDue)).toEqual(['daily-collections.assigned.view']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, PaymentController.prototype.assignedDailyReceived)).toEqual(['daily-collections.assigned.view']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, PaymentController.prototype.dailySummary)).toEqual(['payments.view']);
  });
});
