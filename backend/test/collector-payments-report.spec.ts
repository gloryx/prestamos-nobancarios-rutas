import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { DataSource } from 'typeorm';
import { COLLECTOR_PAYMENTS_REPORT_READER, CollectorPaymentsReportUseCase, CollectorPaymentsReportValidationError }
  from '../src/application/payment/collector-payments-report.use-case';
import { CollectorPaymentsReportTypeormReader } from '../src/infrastructure/database/typeorm/repositories/collector-payments-report.reader';
import { PaymentController } from '../src/presentation/payment/payment.controller';
import { PaymentModule } from '../src/presentation/payment/payment.module';
import { PERMISSIONS_KEY } from '../src/presentation/security/security.decorators';

const collectorId = '11111111-1111-4111-8111-111111111111';
const methodId = '22222222-2222-4222-8222-222222222222';

function harness() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    if (sql.includes('COUNT(*)::int AS "paymentsCount"') && !sql.includes('WITH collector_totals'))
      return [{ paymentsCount: 3, totalReceived: '150.00', principalApplied: '100.00', interestApplied: '50.00' }];
    if (sql.includes('WITH collector_totals')) return [{ collectorId, collectorName: 'Ana Mora', collectorActive: false,
      paymentsCount: 3, customersCount: 2, loansCount: 2, totalReceived: '150.00', principalApplied: '100.00',
      interestApplied: '50.00', averagePayment: '50.00', participationPercentage: '100.00' }];
    if (sql.includes('FROM payment_methods pm')) return [{ id: methodId, name: 'Efectivo', active: true }];
    return [{ id: collectorId, name: 'Ana Mora', active: false }];
  });
  const source = { transaction: jest.fn(async (_level: string, run: (manager: { query: typeof query }) => Promise<unknown>) => run({ query })) };
  return { useCase: new CollectorPaymentsReportUseCase(new CollectorPaymentsReportTypeormReader(source as unknown as DataSource)), source, queries };
}

describe('collector payments report', () => {
  it('aggregates valid attributed payments with inclusive combined filters and deterministic ordering', async () => {
    const { useCase, source, queries } = harness();
    const result = await useCase.execute({ fromDate: '2026-10-01', toDate: '2026-10-31', collectorId, paymentMethodId: methodId });
    expect(result).toMatchObject({ summary: { paymentsCount: 3, totalReceived: '150.00' }, collectors: [{
      collectorName: 'Ana Mora', collectorActive: false, customersCount: 2, loansCount: 2, averagePayment: '50.00',
      participationPercentage: '100.00' }], options: { collectors: [{ active: false }] } });
    expect(source.transaction).toHaveBeenCalledWith('REPEATABLE READ', expect.any(Function));
    expect(queries[0].params).toEqual(['2026-10-01', '2026-10-31', collectorId, methodId]);
    for (const { sql } of queries.slice(0, 2)) {
      expect(sql).toContain("p.status = 'VALID'");
      expect(sql).toContain('p.payment_date >= $1::date');
      expect(sql).toContain('p.payment_date <= $2::date');
      expect(sql).toContain('p.collector_id = $3::uuid');
      expect(sql).toContain('p.method_id = $4::uuid');
      expect(sql).toContain('JOIN collectors cl ON cl.id = p.collector_id');
    }
    expect(queries[1].sql).toContain('COUNT(DISTINCT l.customer_id)');
    expect(queries[1].sql).toContain('COUNT(DISTINCT p.loan_id)');
    expect(queries[1].sql).toContain('ORDER BY total_received DESC, lower("collectorName") ASC, "collectorId" ASC');
  });

  it('returns stable zero totals and no rows when the period or selected collector has no payments', async () => {
    const { useCase, queries } = harness();
    queries.length = 0;
    const reader = { read: jest.fn(async (filters: { fromDate: string; toDate: string }) => ({ filters,
      summary: { paymentsCount: 0, totalReceived: '0.00', principalApplied: '0.00', interestApplied: '0.00' },
      collectors: [], options: { collectors: [], paymentMethods: [] } })) };
    const empty = await new CollectorPaymentsReportUseCase(reader).execute({ fromDate: '2026-09-01', toDate: '2026-09-30' });
    expect(empty.summary).toEqual({ paymentsCount: 0, totalReceived: '0.00', principalApplied: '0.00', interestApplied: '0.00' });
    expect(empty.collectors).toEqual([]);
    expect(queries).toEqual([]);
  });

  it('rejects invalid dates, reversed ranges and identifiers before persistence', () => {
    const { useCase, queries } = harness();
    for (const input of [{ fromDate: '2026-02-29', toDate: '2026-03-01' },
      { fromDate: '2026-10-02', toDate: '2026-10-01' },
      { fromDate: '2026-10-01', toDate: '2026-10-31', collectorId: 'bad' },
      { fromDate: '2026-10-01', toDate: '2026-10-31', paymentMethodId: '' }])
      expect(() => useCase.execute(input)).toThrow(CollectorPaymentsReportValidationError);
    expect(queries).toHaveLength(0);
  });

  it('registers the static endpoint with payments.view without replacing existing payment capabilities', async () => {
    const { useCase } = harness();
    const fn = PaymentController.prototype.collectorPaymentsReport;
    expect(Reflect.getMetadata(PATH_METADATA, fn)).toBe('collector-report');
    expect(Reflect.getMetadata(METHOD_METADATA, fn)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, fn)).toEqual(['payments.view']);
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, PaymentModule) as Array<{ provide: unknown; inject?: unknown[] }>;
    expect(providers.find((provider) => provider.provide === CollectorPaymentsReportUseCase)?.inject)
      .toEqual([COLLECTOR_PAYMENTS_REPORT_READER]);
    const controller = new PaymentController({} as never, {} as never, {} as never, undefined, undefined, undefined, undefined, useCase);
    expect(await controller.collectorPaymentsReport({ fromDate: '2026-10-01', toDate: '2026-10-31' }))
      .toHaveProperty('collectors');
    await expect(controller.collectorPaymentsReport({ fromDate: '2026-02-29', toDate: '2026-03-01' }))
      .rejects.toMatchObject({ status: 400 });
    expect(Reflect.getMetadata(PATH_METADATA, PaymentController.prototype.paymentHistory)).toBe('history');
    expect(Reflect.getMetadata(PATH_METADATA, PaymentController.prototype.create)).toBe('/');
  });
});
