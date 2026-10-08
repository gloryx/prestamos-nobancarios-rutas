import 'reflect-metadata';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { validate } from 'class-validator';
import type { DataSource } from 'typeorm';
import { EconomicCapitalUseCase, ECONOMIC_CAPITAL_READER } from '../src/application/cash-movement/economic-capital.use-case';
import { calculateEconomicCapital, economicCapitalPeriod, EconomicCapitalValidationError, type EconomicCapitalEvent, type EconomicCapitalFacts } from '../src/domain/cash-movement/economic-capital';
import { EconomicCapitalTypeOrmReader } from '../src/infrastructure/database/typeorm/repositories/economic-capital.reader';
import { CashMovementController } from '../src/presentation/cash-movement/cash-movement.controller';
import { EconomicCapitalQueryDto } from '../src/presentation/cash-movement/cash-movement.dto';
import { CashMovementModule } from '../src/presentation/cash-movement/cash-movement.module';
import { PERMISSIONS_KEY } from '../src/presentation/security/security.decorators';

const event = (date: string, realDisbursements = '0.00', capitalRecovered = '0.00', adjustments = '0.00'): EconomicCapitalEvent =>
  ({ date, realDisbursements, capitalRecovered, adjustments });
const facts = (events: EconomicCapitalEvent[] = [], initialPortfolio = '0.00', warnings: string[] = []): EconomicCapitalFacts =>
  ({ opening: { date: '2026-01-01', initialPortfolio }, events, warnings });

describe('daily economic capital engine', () => {
  it.each([['2026-02', 28], ['2024-02', 29], ['2026-04', 30], ['2026-01', 31]] as const)
  ('uses every calendar day in %s', (period, days) => {
    const result = calculateEconomicCapital(period, { opening: { date: '2024-01-01', initialPortfolio: '0.00' }, events: [], warnings: [] });
    expect(result.calendarDays).toBe(days);
    expect(result.daily).toHaveLength(days);
    expect(result.daily[0].date).toBe(`${period}-01`);
    expect(result.daily.at(-1)?.date).toBe(economicCapitalPeriod(period).toDate);
  });

  it('keeps a normal disbursement working without payments and includes Sundays', () => {
    const result = calculateEconomicCapital('2026-09', facts([event('2026-09-01', '100000.00')]));
    expect(result).toMatchObject({ openingEconomicBalance: '0.00', realCapitalDisbursed: '100000.00',
      recoveredCapital: '0.00', averageWorkingCapital: '100000.00', closingEconomicBalance: '100000.00',
      capitalRotation: '1.0000', dataStatus: 'COMPLETE' });
    expect(result.daily.find((day) => day.date === '2026-09-06')).toMatchObject({ closingBalance: '100000.00' });
  });

  it('subtracts partial capital recovery and closes a fully recovered loan during the month', () => {
    const partial = calculateEconomicCapital('2026-09', facts([
      event('2026-09-01', '100000.00'), event('2026-09-10', '0.00', '40000.00'),
    ]));
    expect(partial.daily[9]).toMatchObject({ openingBalance: '100000.00', capitalRecovered: '40000.00', closingBalance: '60000.00' });
    expect(partial.closingEconomicBalance).toBe('60000.00');
    const complete = calculateEconomicCapital('2026-09', facts([
      event('2026-09-01', '100000.00'), event('2026-09-10', '0.00', '100000.00'),
    ]));
    expect(complete.closingEconomicBalance).toBe('0.00');
    expect(complete.recoveredCapital).toBe('100000.00');
  });

  it('shows reuse as rotation rather than a new capital contribution', () => {
    const result = calculateEconomicCapital('2026-09', facts([
      event('2026-09-01', '100000.00'), event('2026-09-10', '0.00', '100000.00'),
      event('2026-09-11', '100000.00'),
    ]));
    expect(result).toMatchObject({ realCapitalDisbursed: '200000.00', recoveredCapital: '100000.00', periodAdjustments: '0.00',
      averageWorkingCapital: '96666.67', closingEconomicBalance: '100000.00', capitalRotation: '2.0690' });
  });

  it('counts only real new-money events across A to B to C and ignores transferred or capitalized amounts', () => {
    const result = calculateEconomicCapital('2026-09', facts([
      event('2026-09-01', '100000.00'),
      event('2026-09-10', '0.00'),
      event('2026-09-20', '52000.00'),
    ]));
    expect(result.realCapitalDisbursed).toBe('152000.00');
    expect(result.closingEconomicBalance).toBe('152000.00');
    expect(result.daily[9]).toMatchObject({ realDisbursements: '0.00', closingBalance: '100000.00' });
  });

  it('restores capital on a payment reversal and removes exposure on a disbursement reversal', () => {
    const result = calculateEconomicCapital('2026-09', facts([
      event('2026-09-01', '100000.00'), event('2026-09-05', '0.00', '40000.00'),
      event('2026-09-08', '0.00', '0.00', '40000.00'), event('2026-09-12', '0.00', '0.00', '-100000.00'),
    ]));
    expect(result.daily[4].closingBalance).toBe('60000.00');
    expect(result.daily[7].closingBalance).toBe('100000.00');
    expect(result.daily[11].closingBalance).toBe('0.00');
    expect(result.recoveredCapital).toBe('40000.00');
    expect(result.periodAdjustments).toBe('-60000.00');
  });

  it('uses all prior facts for the opening balance without leaking later events backward', () => {
    const result = calculateEconomicCapital('2026-09', facts([
      event('2026-08-01', '100.00'), event('2026-08-20', '0.00', '25.00'), event('2026-10-01', '999.00'),
    ], '50.00'));
    expect(result.openingEconomicBalance).toBe('125.00');
    expect(result.closingEconomicBalance).toBe('125.00');
    expect(result.realCapitalDisbursed).toBe('0.00');
  });

  it('returns null rotation for zero average and never emits NaN or Infinity', () => {
    const result = calculateEconomicCapital('2026-09', facts());
    expect(result.capitalRotation).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
  });

  it('does not clamp negative balances and marks integrity explicitly', () => {
    const result = calculateEconomicCapital('2026-09', facts([event('2026-09-01', '0.00', '1.00')]));
    expect(result).toMatchObject({ closingEconomicBalance: '-1.00', dataStatus: 'INCONSISTENT', capitalRotation: null });
    expect(result.warnings).toContain('El saldo económico resulta negativo; existen hechos incompletos o inconsistentes.');
  });

  it('calculates rotation from the unrounded daily sum', () => {
    const result = calculateEconomicCapital('2026-09', facts([event('2026-09-30', '0.01')]));
    expect(result.averageWorkingCapital).toBe('0.00');
    expect(result.capitalRotation).toBe('30.0000');
  });

  it('marks current and future periods as provisional instead of complete', () => {
    expect(calculateEconomicCapital('2026-09', facts(), '2026-09-15')).toMatchObject({ dataStatus: 'WARNING' });
    expect(calculateEconomicCapital('2026-10', facts(), '2026-09-15')).toMatchObject({ dataStatus: 'WARNING' });
  });

  it('returns unavailable rather than inventing history before or without the opening', () => {
    expect(calculateEconomicCapital('2025-12', facts()).dataStatus).toBe('UNAVAILABLE');
    expect(calculateEconomicCapital('2026-09', { opening: null, events: [], warnings: [] })).toMatchObject({
      dataStatus: 'UNAVAILABLE', openingEconomicBalance: null, daily: [], capitalRotation: null,
    });
  });

  it.each(['', '0000-01', '2026-00', '2026-13', '2026-9', '2026-09-01'])('rejects invalid monthly period %p', (period) => {
    expect(() => economicCapitalPeriod(period)).toThrow(EconomicCapitalValidationError);
  });
});

describe('economic capital bulk reader', () => {
  it('uses four constant bulk queries and delegates payment principal to economic provenance', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([{ date: '2026-01-01', initialPortfolio: '25.00' }])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const transaction = jest.fn(async (_isolation: string, run: (manager: { query: typeof query }) => Promise<unknown>) => run({ query }));
    const result = await new EconomicCapitalTypeOrmReader({ transaction } as unknown as DataSource).readThrough('2026-09-30');
    expect(result.events).toEqual([]);
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[1][0]).toContain('FROM loans l');
    expect(query.mock.calls[1][0]).toContain('status_at_cutoff');
    expect(query.mock.calls[1][0]).toContain('candidate.event_sequence DESC');
    expect(query.mock.calls[2][0]).toContain('FROM loan_refinancings');
    expect(query.mock.calls[3][0]).toContain('p.principal_applied::text AS "principalApplied"');
    expect(query.mock.calls.slice(1).map((call) => call[1][0])).toEqual(['2026-09-30', '2026-09-30', '2026-09-30']);
    expect(transaction).toHaveBeenCalledWith('REPEATABLE READ', expect.any(Function));
  });

  it('surfaces incomplete persisted pairs as quality warnings', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([{ date: '2026-01-01', initialPortfolio: '0.00' }])
      .mockResolvedValueOnce([{ loanId: 'legacy', customerId: 'customer', startDate: '2026-01-01', principal: '100.00',
        interestAmount: '0.00', totalAmount: '100.00', status: 'ACTIVE', cancelledDate: null, annulledDate: null }])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const transaction = jest.fn(async (_isolation: string, run: (manager: { query: typeof query }) => Promise<unknown>) => run({ query }));
    const facts = await new EconomicCapitalTypeOrmReader({ transaction } as unknown as DataSource).readThrough('2026-09-30');
    expect(facts.warnings.join(' ')).toContain('evidencia de Caja confiable');
    const result = calculateEconomicCapital('2026-09', facts);
    expect(result.dataStatus).toBe('INCONSISTENT');
    expect(result.capitalRotation).toBeNull();
  });
});

describe('economic capital HTTP contract', () => {
  it('publishes the monthly endpoint with existing view permission and Spanish audit fields', async () => {
    const execute = jest.fn(async () => calculateEconomicCapital('2026-09', facts()));
    const controller = new CashMovementController({} as never, {} as never, {} as never, {} as never,
      { execute } as unknown as EconomicCapitalUseCase);
    await expect(controller.getCapitalRotation({ period: '2026-09' })).resolves.toMatchObject({
      periodo: '2026-09', fechaDesde: '2026-09-01', fechaHasta: '2026-09-30', cantidadDias: 30,
      saldoEconomicoInicial: '0.00', rotacionCapital: null, estadoDatos: 'COMPLETO', serieDiaria: expect.any(Array),
    });
    const handler = CashMovementController.prototype.getCapitalRotation;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('capital-rotation');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual(['cash-movements.view']);
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, CashMovementModule) as Array<{ provide: unknown; inject?: unknown[] }>;
    expect(providers.find((provider) => provider.provide === EconomicCapitalUseCase)?.inject).toEqual([ECONOMIC_CAPITAL_READER]);
  });

  it('rejects malformed DTO periods before application execution', async () => {
    expect(await validate(Object.assign(new EconomicCapitalQueryDto(), { period: '2026-09' }))).toHaveLength(0);
    for (const period of ['0000-01', '2026-9', '2026-13', '2026-09-01'])
      expect(await validate(Object.assign(new EconomicCapitalQueryDto(), { period }))).toEqual(expect.arrayContaining([expect.objectContaining({ property: 'period' })]));
  });
});
