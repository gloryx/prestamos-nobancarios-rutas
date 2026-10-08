import 'reflect-metadata';
import type { DataSource } from 'typeorm';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import {
  COLLECTION_AGENDA_READER,
  CollectionAgendaUseCase,
  CollectionAgendaValidationError,
  costaRicaEconomicDate,
  type CollectionAgendaCollectorAccess,
  type CollectionAgendaRead,
  type CollectionAgendaReader,
  type CollectionAgendaRow,
  type CollectionAgendaScope,
  type ValidCollectionAgendaQuery,
} from '../src/application/payment/collection-agenda.use-case';
import type { CurrentIdentity } from '../src/domain/security/security.types';
import { CollectionAgendaTypeormReader } from '../src/infrastructure/database/typeorm/repositories/collection-agenda.reader';
import { PaymentController } from '../src/presentation/payment/payment.controller';
import { PaymentModule } from '../src/presentation/payment/payment.module';
import { PERMISSIONS_KEY } from '../src/presentation/security/security.decorators';
import { COLLECTION_MANAGER_DEFAULTS, COLLECTOR_DEFAULTS, PERMISSIONS } from '../src/shared/constants/security';

const ids = {
  customer: '10000000-0000-4000-8000-000000000001',
  route: '20000000-0000-4000-8000-000000000001',
  collector: '30000000-0000-4000-8000-000000000001',
  otherCollector: '30000000-0000-4000-8000-000000000002',
  collectorUser: '40000000-0000-4000-8000-000000000001',
  otherRoute: '20000000-0000-4000-8000-000000000002',
  otherCustomer: '10000000-0000-4000-8000-000000000002',
};

const identity = (roleCode: string, isSuperAdmin = false, id = '50000000-0000-4000-8000-000000000001'): CurrentIdentity => ({
  id, username: 'user', fullName: 'Test User', sessionId: 'session', permissions: ['collection-agenda.view'],
  role: { id: '60000000-0000-4000-8000-000000000001', code: roleCode, name: roleCode, isSuperAdmin },
});
const administrator = identity('ADMIN', true);
const officeUser = identity('COLLECTION_MANAGER');
const collectorUser = identity('COLLECTOR', false, ids.collectorUser);

const row = (values: Partial<CollectionAgendaRow> = {}): CollectionAgendaRow => ({
  loanId: 'loan-1', loanNumber: '101', paymentPlanEntryId: 'entry-1', sequence: 1,
  dueDate: '2026-10-04', pendingAmount: '12000.00', overdueAmount: '0.00', scheduledAmount: '12000.00', collectionStatus: 'DUE_TODAY', assignmentStatus: 'ASSIGNED',
  customerId: ids.customer, customerName: 'María Solís', identification: '101110111', primaryPhone: '88880000', secondaryPhone: '22220000',
  exactAddress: '100 m norte', latitude: '9.9281000', longitude: '-84.0907000', hasPropertyPhoto: true,
  district: 'Carmen', canton: 'San José', province: 'San José', routeId: ids.route, routeName: 'Ruta Centro',
  collectorId: ids.collector, collectorUserId: ids.collectorUser, collectorName: 'Carlos Mora', ...values,
});

const result = (items: CollectionAgendaRow[]): CollectionAgendaRead => ({
  summary: {
    overdue: { obligations: 2, customers: 1, amount: '15000.00' },
    dueToday: { obligations: 1, customers: 1, amount: '12000.00' },
    upcoming: { obligations: 1, customers: 1, amount: '9000.00' },
  },
  total: items.length,
  issueCounts: { UNASSIGNED_ROUTE: 0, UNASSIGNED_COLLECTOR: 0, INVALID_COLLECTOR: 0, INVALID_ROUTE: 0 },
  items,
});

class StubReader implements CollectionAgendaReader {
  query?: ValidCollectionAgendaQuery;
  scope?: CollectionAgendaScope;
  resolveCalls: Array<{ userId: string; routeId?: string; customerId?: string }> = [];
  readCalls = 0;
  constructor(private readonly value: CollectionAgendaRead,
    private readonly access: CollectionAgendaCollectorAccess | null = { collectorId: ids.collector, routeAllowed: true, customerAllowed: true }) {}
  resolveCollectorAccess(userId: string, routeId?: string, customerId?: string) {
    this.resolveCalls.push({ userId, routeId, customerId });
    return Promise.resolve(this.access);
  }
  read(query: ValidCollectionAgendaQuery, scope: CollectionAgendaScope) {
    this.query = query; this.scope = scope; this.readCalls += 1; return Promise.resolve(this.value);
  }
}

describe('collection agenda use case', () => {
  it('uses the Costa Rica economic date instead of the server-local calendar date', async () => {
    const instant = new Date('2026-10-05T05:30:00.000Z');
    expect(costaRicaEconomicDate(instant)).toBe('2026-10-04');
    const reader = new StubReader(result([]));
    await new CollectionAgendaUseCase(reader, () => instant).execute({}, administrator);
    expect(reader.query?.referenceDate).toBe('2026-10-04');
  });

  it('validates dates, ranges, ids, statuses and bounded paging before reading', async () => {
    const reader = new StubReader(result([]));
    const useCase = new CollectionAgendaUseCase(reader);
    for (const input of [
      { referenceDate: '2026-02-29' }, { referenceDate: '2026-10-04', fromDate: '2026-10-05', toDate: '2026-10-04' },
      { referenceDate: '2026-10-04', collectorId: 'not-a-uuid' }, { referenceDate: '2026-10-04', collectionStatus: 'LATE' as never },
      { referenceDate: '2026-10-04', page: 0 }, { referenceDate: '2026-10-04', pageSize: 101 },
    ]) await expect(useCase.execute(input, administrator)).rejects.toBeInstanceOf(CollectionAgendaValidationError);
    expect(reader.query).toBeUndefined();
  });

  it('keeps two ACTIVE loan obligations under one customer and preserves backend summary semantics', async () => {
    const reader = new StubReader(result([
      row({ loanId: 'loan-101', paymentPlanEntryId: 'entry-a', collectionStatus: 'OVERDUE', dueDate: '2026-10-02', pendingAmount: '5000.00' }),
      row({ loanId: 'loan-145', loanNumber: '145', paymentPlanEntryId: 'entry-b', collectionStatus: 'OVERDUE', dueDate: '2026-10-03', pendingAmount: '10000.00' }),
    ]));
    const agenda = await new CollectionAgendaUseCase(reader).execute({ referenceDate: '2026-10-04', collectionStatus: 'OVERDUE' }, administrator);
    expect(agenda.collectors[0].routes[0].customers).toHaveLength(1);
    expect(agenda.collectors[0].routes[0].customers[0].obligations.map((item) => item.loanId)).toEqual(['loan-101', 'loan-145']);
    expect(agenda.summary.overdue).toEqual({ obligations: 2, customers: 1, amount: '15000.00' });
    expect(reader.query).toMatchObject({ referenceDate: '2026-10-04', collectionStatus: 'OVERDUE', page: 1, pageSize: 20 });
  });

  it('groups current assignment problems explicitly without hiding obligations', async () => {
    const value = result([
      row({ loanId: 'without-route', assignmentStatus: 'UNASSIGNED_ROUTE', routeId: null, routeName: null, collectorId: null, collectorUserId: null, collectorName: null }),
      row({ loanId: 'without-collector', assignmentStatus: 'UNASSIGNED_COLLECTOR', collectorId: null, collectorUserId: null, collectorName: null }),
      row({ loanId: 'invalid-collector', assignmentStatus: 'INVALID_COLLECTOR' }),
      row({ loanId: 'invalid-route', assignmentStatus: 'INVALID_ROUTE' }),
    ]);
    value.issueCounts = { UNASSIGNED_ROUTE: 1, UNASSIGNED_COLLECTOR: 1, INVALID_COLLECTOR: 1, INVALID_ROUTE: 1 };
    const agenda = await new CollectionAgendaUseCase(new StubReader(value)).execute({ referenceDate: '2026-10-04' }, administrator);
    expect(agenda.unassigned.withoutRoute[0].obligations[0].loanId).toBe('without-route');
    expect(agenda.unassigned.withoutCollector[0].customers[0].obligations[0].loanId).toBe('without-collector');
    expect(agenda.unassigned.invalidCollector[0]).toMatchObject({ collectorId: ids.collector, collectorUserId: ids.collectorUser });
    expect(agenda.unassigned.invalidRoute[0].customers[0].obligations[0].loanId).toBe('invalid-route');
    expect(agenda.warnings.map((warning) => warning.code)).toEqual(['UNASSIGNED_ROUTE', 'UNASSIGNED_COLLECTOR', 'INVALID_COLLECTOR', 'INVALID_ROUTE']);
  });

  it('returns operational customer data without exposing a storage key', async () => {
    const agenda = await new CollectionAgendaUseCase(new StubReader(result([row()]))).execute({ referenceDate: '2026-10-04' }, administrator);
    const customer = agenda.collectors[0].routes[0].customers[0];
    expect(customer).toMatchObject({
      identification: '101110111', primaryPhone: '88880000', secondaryPhone: '22220000',
      address: { exact: '100 m norte', district: 'Carmen', canton: 'San José', province: 'San José' },
      coordinates: { latitude: '9.9281000', longitude: '-84.0907000' },
      propertyPhoto: { available: true, accessPath: `/customers/${ids.customer}/files/property` },
    });
    expect(JSON.stringify(customer)).not.toContain('fileKey');
  });

  it('preserves general and collector-filtered access for administrative users', async () => {
    const general = new StubReader(result([]));
    await new CollectionAgendaUseCase(general).execute({ referenceDate: '2026-10-04' }, officeUser);
    expect(general.scope).toEqual({ kind: 'ALL' });
    expect(general.resolveCalls).toHaveLength(0);

    const filtered = new StubReader(result([]));
    await new CollectionAgendaUseCase(filtered).execute({ referenceDate: '2026-10-04', collectorId: ids.otherCollector }, officeUser);
    expect(filtered.query?.collectorId).toBe(ids.otherCollector);
    expect(filtered.scope).toEqual({ kind: 'ALL' });
  });

  it('automatically scopes a collector and accepts its own explicit collector id', async () => {
    for (const input of [{}, { collectorId: ids.collector }]) {
      const reader = new StubReader(result([]));
      await new CollectionAgendaUseCase(reader).execute({ referenceDate: '2026-10-04', ...input }, collectorUser);
      expect(reader.resolveCalls).toEqual([{ userId: ids.collectorUser, routeId: undefined, customerId: undefined }]);
      expect(reader.query?.collectorId).toBe(ids.collector);
      expect(reader.scope).toEqual({ kind: 'COLLECTOR', collectorId: ids.collector, collectorUserId: ids.collectorUser });
    }
  });

  it('rejects a collector id outside the authenticated collector scope before reading agenda rows', async () => {
    const reader = new StubReader(result([]));
    await expect(new CollectionAgendaUseCase(reader).execute({ collectorId: ids.otherCollector }, collectorUser))
      .rejects.toThrow('requested collector is outside');
    expect(reader.readCalls).toBe(0);
  });

  it('rejects route and customer filters outside current collector assignments', async () => {
    const routeReader = new StubReader(result([]), { collectorId: ids.collector, routeAllowed: false, customerAllowed: true });
    await expect(new CollectionAgendaUseCase(routeReader).execute({ routeId: ids.otherRoute }, collectorUser))
      .rejects.toThrow('requested route is outside');
    expect(routeReader.readCalls).toBe(0);

    const customerReader = new StubReader(result([]), { collectorId: ids.collector, routeAllowed: true, customerAllowed: false });
    await expect(new CollectionAgendaUseCase(customerReader).execute({ customerId: ids.otherCustomer }, collectorUser))
      .rejects.toThrow('requested customer is outside');
    expect(customerReader.readCalls).toBe(0);
  });

  it.each(['has no linked Collector', 'has an inactive or otherwise invalid Collector'])(
    'fails closed when the authenticated collector %s', async () => {
      const reader = new StubReader(result([]), null);
      await expect(new CollectionAgendaUseCase(reader).execute({}, collectorUser)).rejects.toThrow('active collector profile');
      expect(reader.readCalls).toBe(0);
    },
  );

  it('keeps multiple currently assigned routes inside the collector scope', async () => {
    const reader = new StubReader(result([
      row(),
      row({ loanId: 'loan-2', paymentPlanEntryId: 'entry-2', routeId: ids.otherRoute, routeName: 'Ruta Norte' }),
    ]));
    const agenda = await new CollectionAgendaUseCase(reader).execute({}, collectorUser);
    expect(agenda.collectors[0].routes.map((route) => route.routeId)).toEqual([ids.route, ids.otherRoute]);
    expect(reader.scope?.kind).toBe('COLLECTOR');
  });
});

describe('collection agenda PostgreSQL reader contract', () => {
  it('selects one deterministic pending entry per ACTIVE loan and classifies it from persisted plan data', async () => {
    const query = jest.fn().mockResolvedValue([{
      overdueObligations: 1, overdueCustomers: 1, overdueAmount: '12000.00',
      dueTodayObligations: 0, dueTodayCustomers: 0, dueTodayAmount: '0.00',
      upcomingObligations: 0, upcomingCustomers: 0, upcomingAmount: '0.00',
      unassignedRoute: 0, unassignedCollector: 0, invalidCollector: 0, invalidRoute: 0, total: 1,
      items: [row({ collectionStatus: 'OVERDUE', pendingAmount: '12000.00' })],
    }]);
    const reader = new CollectionAgendaTypeormReader({ query } as unknown as DataSource);
    const read = await reader.read({ referenceDate: '2026-10-04', collectionStatus: 'ALL', page: 1, pageSize: 20 }, { kind: 'ALL' });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("l.status = 'ACTIVE'");
    expect(sql).toContain('c.is_active = true');
    expect(sql).toContain('e.pending_amount > 0');
    expect(sql).toContain('ROW_NUMBER() OVER (PARTITION BY e.loan_id ORDER BY e.due_date ASC, e.sequence ASC, e.id ASC)');
    expect(sql).toContain('e.future_position = 1');
    expect(sql).toContain('SUM(CASE WHEN e.due_date < $1::date THEN e.pending_amount');
    expect(sql).toContain("e.future_count = 0 OR e.due_date = $1::date THEN 'DUE_TODAY'");
    expect(sql).toContain("ELSE 'UPCOMING'");
    expect(sql).toContain('FROM payment_applications pa');
    expect(sql).not.toContain('payment_frequencies');
    for (const excluded of ['REFINANCED', 'CANCELLED', 'ANNULLED', 'UNCOLLECTIBLE']) expect(sql).not.toContain(`l.status = '${excluded}'`);
    expect(params).toEqual(['2026-10-04', 20, 0]);
    expect(read.items[0].pendingAmount).toBe('12000.00');
  });

  it('uses only active current assignments, detects invalid collectors and keeps summary independent from page', async () => {
    const query = jest.fn().mockResolvedValue([{
      overdueObligations: 0, overdueCustomers: 0, overdueAmount: '0.00', dueTodayObligations: 0, dueTodayCustomers: 0,
      dueTodayAmount: '0.00', upcomingObligations: 0, upcomingCustomers: 0, upcomingAmount: '0.00',
      unassignedRoute: 0, unassignedCollector: 0, invalidCollector: 0, invalidRoute: 0, total: 0, items: [],
    }]);
    const reader = new CollectionAgendaTypeormReader({ query } as unknown as DataSource);
    await reader.read({ referenceDate: '2026-10-04', fromDate: '2026-10-05', toDate: '2026-10-11', collectorId: ids.collector,
      routeId: ids.route, customerId: ids.customer, collectionStatus: 'UPCOMING', search: ' María ', page: 2, pageSize: 10 }, { kind: 'ALL' });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('ca.ended_at IS NULL');
    expect(sql).toContain('cra.ended_at IS NULL');
    expect(sql).toContain("role.code <> 'COLLECTOR'");
    expect(sql).toContain('COUNT(DISTINCT customer_id)');
    expect(sql).toContain('SUM(pending_amount)');
    expect(sql.indexOf('FROM filtered\n      ), page')).toBeGreaterThan(-1);
    expect(sql).toContain('LIMIT $9 OFFSET $10');
    expect(params).toEqual(['2026-10-04', '2026-10-05', '2026-10-11', ids.collector, ids.route, ids.customer, 'UPCOMING', '% María %', 10, 10]);
  });

  it('resolves only an active Collector and validates current active route and customer assignments', async () => {
    const query = jest.fn().mockResolvedValue([{ collectorId: ids.collector, routeAllowed: true, customerAllowed: true }]);
    const access = await new CollectionAgendaTypeormReader({ query } as unknown as DataSource)
      .resolveCollectorAccess(ids.collectorUser, ids.route, ids.customer);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("role.is_active = true AND role.code = 'COLLECTOR'");
    expect(sql).toContain('cl.user_id = u.id AND cl.is_active = true');
    expect(sql).toContain('u.id = $1::uuid AND u.is_active = true');
    expect(sql).toContain('cra.ended_at IS NULL AND cra.route_id = $2::uuid');
    expect(sql).toContain('ca.customer_id = $3::uuid AND ca.ended_at IS NULL');
    expect(sql).toContain('r.id = ca.route_id AND r.is_active = true');
    expect(params).toEqual([ids.collectorUser, ids.route, ids.customer]);
    expect(access).toEqual({ collectorId: ids.collector, routeAllowed: true, customerAllowed: true });
  });

  it('applies collector ownership before search, summary and pagination and excludes ended historical assignments', async () => {
    const query = jest.fn().mockResolvedValue([{
      overdueObligations: 1, overdueCustomers: 1, overdueAmount: '12000.00', dueTodayObligations: 0, dueTodayCustomers: 0,
      dueTodayAmount: '0.00', upcomingObligations: 0, upcomingCustomers: 0, upcomingAmount: '0.00',
      unassignedRoute: 0, unassignedCollector: 0, invalidCollector: 0, invalidRoute: 0, total: 1, items: [row()],
    }]);
    const reader = new CollectionAgendaTypeormReader({ query } as unknown as DataSource);
    await reader.read({ referenceDate: '2026-10-04', collectorId: ids.collector, search: 'Ana', collectionStatus: 'ALL', page: 2, pageSize: 5 },
      { kind: 'COLLECTOR', collectorId: ids.collector, collectorUserId: ids.collectorUser });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    const ownership = sql.indexOf('cra.collector_user_id = $2::uuid');
    const filtered = sql.indexOf('filtered AS MATERIALIZED');
    expect(ownership).toBeGreaterThan(-1);
    expect(ownership).toBeLessThan(filtered);
    expect(sql).toContain('ca.ended_at IS NULL');
    expect(sql).toContain('cra.route_id = ca.route_id AND cra.ended_at IS NULL');
    expect(sql).toContain("cl.id = $3::uuid");
    expect(sql).toContain("role.is_active = true AND role.code = 'COLLECTOR'");
    expect(sql).toContain('FROM filtered');
    expect(sql).toContain('FROM filtered\n        ORDER BY');
    expect(sql).toContain('o.customer_name ILIKE $5');
    expect(sql).toContain('LIMIT $6 OFFSET $7');
    expect(params).toEqual(['2026-10-04', ids.collectorUser, ids.collector, ids.collector, '%Ana%', 5, 5]);
  });
});

describe('collection agenda HTTP registration', () => {
  it('registers a dedicated permission and endpoint while preserving daily collections', async () => {
    const handler = PaymentController.prototype.agenda;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('collection-agenda');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual(['collection-agenda.view']);
    expect(PERMISSIONS.filter(([code]) => code === 'collection-agenda.view')).toEqual([
      ['collection-agenda.view', 'Ver agenda de cobros', 'COBRANZAS'],
    ]);
    expect(COLLECTION_MANAGER_DEFAULTS).not.toContain('collection-agenda.view');
    expect(COLLECTOR_DEFAULTS).toContain('collection-agenda.view');
    expect(COLLECTOR_DEFAULTS).not.toEqual(expect.arrayContaining([
      'payments.create', 'payments.annul', 'payments.plan.customize', 'routes.assign.collectors', 'routes.assign.customers',
    ]));
    expect(Reflect.getMetadata(PATH_METADATA, PaymentController.prototype.dailyDue)).toBe('daily-collections/due');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, PaymentController.prototype.dailyDue)).toEqual(['payments.view']);
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, PaymentModule) as Array<{ provide: unknown; inject?: unknown[] }>;
    expect(providers.find((provider) => provider.provide === CollectionAgendaUseCase)?.inject).toEqual([COLLECTION_AGENDA_READER]);

    const stub = new StubReader(result([]));
    const controller = new PaymentController({} as never, {} as never, {} as never, undefined, undefined, undefined, new CollectionAgendaUseCase(stub));
    await expect(controller.agenda({ referenceDate: '2026-10-04', page: '1', pageSize: '20' }, administrator)).resolves.toMatchObject({ referenceDate: '2026-10-04' });
    await expect(controller.agenda({ referenceDate: '2026-02-29' }, administrator)).rejects.toMatchObject({ status: 400 });

    const forbidden = new PaymentController({} as never, {} as never, {} as never, undefined, undefined, undefined,
      new CollectionAgendaUseCase(new StubReader(result([]), null)));
    await expect(forbidden.agenda({}, collectorUser)).rejects.toMatchObject({ status: 403 });
  });
});
