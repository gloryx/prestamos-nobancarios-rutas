import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { validate } from 'class-validator';
import type { DataSource } from 'typeorm';
import { PORTFOLIO_TRACKING_READER, PortfolioTrackingUseCase, type PortfolioTrackingReader } from '../src/application/payment/portfolio-tracking.use-case';
import { PaymentValidationError } from '../src/application/payment/payment.errors';
import { PortfolioTrackingTypeormReader } from '../src/infrastructure/database/typeorm/repositories/portfolio-tracking.reader';
import { PERMISSIONS_KEY } from '../src/presentation/security/security.decorators';
import { PaymentController } from '../src/presentation/payment/payment.controller';
import { PortfolioTrackingQueryDto } from '../src/presentation/payment/payment.dto';
import { PaymentModule } from '../src/presentation/payment/payment.module';

const context = {
  summary: { loanId: 'loan-1', loanNumber: '9', status: 'ACTIVE', customerName: 'Ana', identification: '101',
    principal: '70.00', interestAmount: '30.00', totalAmount: '100.00' },
  balances: { outstandingPrincipal: '40.00', outstandingInterest: '20.00', financialBalance: '60.00' },
  combinedPlan: [{ id: 'entry-1', sequence: 1, dueDate: '2026-10-04', pendingAmount: '60.00' }],
  validPayments: [], firstOperationalRow: null, lastValidPayment: null, refinanceEligibility: false,
  preferredMethod: { id: null, activeMethods: [], collectors: [] },
};

describe('portfolio tracking', () => {
  it('combines search, real loan status, collection status and position in one server-side query', async () => {
    const query = jest.fn().mockResolvedValue([{ loanId: 'loan-1', status: 'ACTIVE', collectionStatus: 'OVERDUE',
      startDate: '2026-01-01', contractualDueDate: '2026-12-01', position: 2, total: 7 }]);
    const reader = new PortfolioTrackingTypeormReader({ query } as unknown as DataSource);
    const result = await reader.locate({ search: ' María ', status: 'ACTIVE', collectionStatus: 'OVERDUE', position: 2 });

    expect(result).toMatchObject({ loanId: 'loan-1', position: 2, total: 7, collectionStatus: 'OVERDUE' });
    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual([' María ', 'ACTIVE', 'OVERDUE', 2, '% María %']);
    expect(sql).toContain('l.loan_number::text ILIKE $5');
    expect(sql).toContain('c.identification ILIKE $5');
    expect(sql).toContain('c.primary_phone ILIKE $5');
    expect(sql).toContain("COALESCE(c.secondary_phone, '') ILIKE $5");
    expect(sql).toContain("l.status IN ('ACTIVE', 'UNCOLLECTIBLE')");
    expect(sql).toContain('COALESCE(pf.pending_total, 0) > 0');
    expect(sql).toContain("$2 = 'ALL' OR l.status = $2");
    expect(sql).toContain("$3 = 'ALL' OR collection_status = $3");
    expect(sql).toContain('row_number() OVER');
    expect(sql).toContain('count(*) OVER ()');
    expect(sql).toContain('WHERE position = LEAST($4, total)');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('supports an unfiltered first-position query without downloading the portfolio', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new PortfolioTrackingTypeormReader({ query } as unknown as DataSource)
      .locate({ search: '', status: 'ALL', collectionStatus: 'ALL', position: 1 });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual(['', 'ALL', 'ALL', 1, '%%']);
  });

  it('derives mutually exclusive collection conditions from the current positive plan', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new PortfolioTrackingTypeormReader({ query } as unknown as DataSource)
      .locate({ search: '', status: 'ALL', collectionStatus: 'ALL', position: 1 });
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain('e.pending_amount > 0');
    expect(sql).toContain('MAX(e.due_date) FILTER (WHERE e.pending_amount > 0) AS contractual_due_date');
    expect(sql).toContain("pf.contractual_due_date < CURRENT_DATE THEN 'TERM_EXPIRED'");
    expect(sql).toContain("pf.first_pending_due_date < CURRENT_DATE THEN 'OVERDUE'");
    expect(sql).toContain("pf.first_pending_due_date = CURRENT_DATE THEN 'PENDING'");
    expect(sql).toContain("ELSE 'ON_TRACK'");
    expect(sql.indexOf("THEN 'TERM_EXPIRED'")).toBeLessThan(sql.indexOf("THEN 'OVERDUE'"));
  });

  it('trims combined filters, delegates exactly one canonical context and validates direct callers', async () => {
    const locate = jest.fn().mockResolvedValue({ loanId: 'loan-1', status: 'ACTIVE', collectionStatus: 'OVERDUE',
      startDate: '2026-01-01', contractualDueDate: '2026-12-01', position: 7, total: 7 });
    const execute = jest.fn().mockResolvedValue(context);
    const useCase = new PortfolioTrackingUseCase({ locate }, { execute } as never);
    await expect(useCase.execute({ search: '  María  ', status: 'ACTIVE', collectionStatus: 'OVERDUE', position: 99 }))
      .resolves.toMatchObject({ position: 7, total: 7, hasPrevious: true, hasNext: false });
    expect(locate).toHaveBeenCalledWith({ search: 'María', status: 'ACTIVE', collectionStatus: 'OVERDUE', position: 99 });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('loan-1');
    for (const invalid of [
      { search: '', status: 'CANCELLED', collectionStatus: 'ALL', position: 1 },
      { search: '', status: 'ALL', collectionStatus: 'COLLECTED', position: 1 },
      { search: '', status: 'ALL', collectionStatus: 'ALL', position: 0 },
    ]) await expect(useCase.execute(invalid as never)).rejects.toBeInstanceOf(PaymentValidationError);
    expect(locate).toHaveBeenCalledTimes(1);
  });

  it('returns one located context with positional flags and preserves canonical balances and plan', async () => {
    const reader: PortfolioTrackingReader = { locate: jest.fn().mockResolvedValue({ loanId: 'loan-1', status: 'ACTIVE',
      collectionStatus: 'PENDING', startDate: '2026-01-01', contractualDueDate: '2026-10-04', position: 1, total: 3 }) };
    const execute = jest.fn().mockResolvedValue(context);
    const result = await new PortfolioTrackingUseCase(reader, { execute } as never).execute({ search: 'Ana', status: 'ACTIVE', collectionStatus: 'PENDING', position: 1 });
    expect(result).toMatchObject({ position: 1, total: 3, hasPrevious: false, hasNext: true,
      loan: { status: 'ACTIVE', collectionStatus: 'PENDING', context: { balances: context.balances, combinedPlan: context.combinedPlan } } });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('loan-1');
  });

  it('clears context and navigation when the combined query has no results', async () => {
    const execute = jest.fn();
    const result = await new PortfolioTrackingUseCase({ locate: jest.fn().mockResolvedValue(null) }, { execute } as never)
      .execute({ search: 'Nobody', status: 'UNCOLLECTIBLE', collectionStatus: 'TERM_EXPIRED', position: 9 });
    expect(result).toEqual({ position: 0, total: 0, hasPrevious: false, hasNext: false, loan: null });
    expect(execute).not.toHaveBeenCalled();
  });

  it('validates only existing statuses, derived collection values and positive positions', async () => {
    const valid = Object.assign(new PortfolioTrackingQueryDto(), { status: 'UNCOLLECTIBLE', collectionStatus: 'TERM_EXPIRED', position: '4' });
    expect(await validate(valid)).toHaveLength(0);
    for (const values of [{ status: 'CANCELLED' }, { status: 'PAST_DUE' }, { collectionStatus: 'COLLECTED' }, { position: '0' }]) {
      expect(await validate(Object.assign(new PortfolioTrackingQueryDto(), values))).not.toHaveLength(0);
    }
  });

  it('publishes one payments.view endpoint inside the existing payment module', async () => {
    const method = PaymentController.prototype.portfolioTracking;
    expect(Reflect.getMetadata(PATH_METADATA, method)).toBe('portfolio-tracking');
    expect(Reflect.getMetadata(METHOD_METADATA, method)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, method)).toEqual(['payments.view']);
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, PaymentModule) as Array<{ provide: unknown; inject?: unknown[] }>;
    expect(providers.find((provider) => provider.provide === PortfolioTrackingUseCase)?.inject)
      .toEqual([PORTFOLIO_TRACKING_READER, expect.any(Function)]);

    const execute = jest.fn().mockResolvedValue({ position: 1, total: 1 });
    const controller = new PaymentController({} as never, {} as never, {} as never, undefined, undefined, { execute } as never);
    await controller.portfolioTracking({ search: 'Ana', status: 'UNCOLLECTIBLE', collectionStatus: 'ALL', position: '2' });
    expect(execute).toHaveBeenCalledWith({ search: 'Ana', status: 'UNCOLLECTIBLE', collectionStatus: 'ALL', position: 2 });
  });
});
