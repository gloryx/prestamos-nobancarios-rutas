import { classifyCustomerAgendaAssignment, CustomerAgendaForbiddenError, CustomerAgendaUseCase, type CustomerAgendaAssignmentFacts, type CustomerAgendaResponse } from '../src/application/customer/customer-agenda.use-case';
import { CustomerValidationError } from '../src/domain/customer/customer.errors';
import type { CurrentIdentity } from '../src/domain/security/security.types';
import { CUSTOMER_AGENDA_SQL, CustomerAgendaTypeOrmReader } from '../src/infrastructure/database/typeorm/repositories/customer-agenda.reader';

const facts = (patch: Partial<CustomerAgendaAssignmentFacts> = {}): CustomerAgendaAssignmentFacts => ({
  hasCurrentRouteAssignment: true, routeExists: true, routeActive: true,
  hasCurrentCollectorAssignment: true, collectorExists: true, collectorActive: true,
  userActive: true, roleActive: true, collectorRole: true, ...patch,
});

const response: CustomerAgendaResponse = {
  summary: { total: 5, assigned: 1, unassigned: 4, withoutRoute: 1, routeWithoutCollector: 1, invalidRoute: 1, invalidCollector: 1 },
  pagination: { page: 1, pageSize: 20, total: 5, totalPages: 1 },
  options: { collectors: [], routes: [], provinces: [], cantons: [], districts: [] }, items: [],
};
const actor = (code: string, permissions: string[], isSuperAdmin = false): CurrentIdentity => ({
  id: `${code.toLowerCase()}-user`, username: code.toLowerCase(), fullName: code,
  role: { id: `${code.toLowerCase()}-role`, code, name: code, isSuperAdmin }, permissions, sessionId: 'session',
});
const manager = actor('GESTOR', ['customers.view']);
const collector = actor('COLLECTOR', ['customers.assigned.view']);

describe('CustomerAgendaUseCase', () => {
  it('applies contract defaults and trims search', async () => {
    const read = jest.fn(async () => response);
    await new CustomerAgendaUseCase({ read }).execute({ search: '  Ana  ' }, manager);
    expect(read).toHaveBeenCalledWith({ search: 'Ana', assignmentStatus: 'ALL', page: 1, pageSize: 20 }, { kind: 'ALL' });
  });

  it('forwards all supported filters', async () => {
    const read = jest.fn(async () => response);
    const query = { search: '8888', collectorId: 'collector', routeId: 'route', provinceCode: 1,
      cantonCode: 101, districtCode: 10101, assignmentStatus: 'UNASSIGNED' as const, page: 2, pageSize: 50 as const };
    await new CustomerAgendaUseCase({ read }).execute(query, manager);
    expect(read).toHaveBeenCalledWith(query, { kind: 'ALL' });
  });

  it.each([
    [{ page: 0 }, 'La página'], [{ pageSize: 25 }, 'tamaño de página'],
    [{ provinceCode: 0 }, 'provincia'], [{ cantonCode: 1.5 }, 'cantón'], [{ districtCode: -1 }, 'distrito'],
    [{ assignmentStatus: 'OTHER' }, 'estado de asignación'],
  ])('rejects invalid application input %p', async (query, message) => {
    await expect(new CustomerAgendaUseCase({ read: async () => response }).execute(query as never, manager))
      .rejects.toThrow(new RegExp(message as string, 'i'));
    await expect(new CustomerAgendaUseCase({ read: async () => response }).execute(query as never, manager))
      .rejects.toBeInstanceOf(CustomerValidationError);
  });

  it.each([
    ['ADMIN', actor('ADMIN', [], true)],
    ['GESTOR', manager],
  ])('preserves the global scope for %s', async (_label, identity) => {
    const read = jest.fn(async () => response);
    await new CustomerAgendaUseCase({ read }).execute({}, identity);
    expect(read).toHaveBeenCalledWith(expect.any(Object), { kind: 'ALL' });
  });

  it('derives collector scope only from the authenticated user and keeps manipulated filters inside it', async () => {
    const read = jest.fn(async () => response);
    const query = { collectorId: 'other-collector', routeId: 'other-route', search: 'Outside',
      assignmentStatus: 'UNASSIGNED' as const, page: 999, pageSize: 50 as const };
    await new CustomerAgendaUseCase({ read }).execute(query, collector);
    expect(read).toHaveBeenCalledWith(query, { kind: 'COLLECTOR', collectorUserId: 'collector-user' });
  });

  it('returns the reader empty result normally when the collector has no assigned routes or customers', async () => {
    const empty = { ...response, summary: { ...response.summary, total: 0, assigned: 0, unassigned: 0,
      withoutRoute: 0, routeWithoutCollector: 0, invalidRoute: 0, invalidCollector: 0 } };
    const result = await new CustomerAgendaUseCase({ read: async () => empty }).execute({}, collector);
    expect(result).toBe(empty);
  });

  it('never turns customers.view into global access for a non-superadmin COLLECTOR', async () => {
    await expect(new CustomerAgendaUseCase({ read: async () => response })
      .execute({}, actor('COLLECTOR', ['customers.view']))).rejects.toBeInstanceOf(CustomerAgendaForbiddenError);
  });

  it('does not grant global access to a non-collector with only the scoped permission', async () => {
    await expect(new CustomerAgendaUseCase({ read: async () => response })
      .execute({}, actor('OTHER', ['customers.assigned.view']))).rejects.toBeInstanceOf(CustomerAgendaForbiddenError);
  });
});

describe('customer agenda assignment semantics', () => {
  it.each([
    ['ASSIGNED', {}],
    ['WITHOUT_ROUTE', { hasCurrentRouteAssignment: false }],
    ['INVALID_ROUTE', { routeExists: false, hasCurrentCollectorAssignment: false }],
    ['INVALID_ROUTE', { routeActive: false, hasCurrentCollectorAssignment: false }],
    ['WITHOUT_COLLECTOR', { hasCurrentCollectorAssignment: false }],
    ['INVALID_COLLECTOR', { collectorExists: false }],
    ['INVALID_COLLECTOR', { collectorActive: false }],
    ['INVALID_COLLECTOR', { userActive: false }],
    ['INVALID_COLLECTOR', { roleActive: false }],
    ['INVALID_COLLECTOR', { collectorRole: false }],
  ])('classifies %s with strict precedence', (expected, patch) => {
    expect(classifyCustomerAgendaAssignment(facts(patch))).toBe(expected);
  });
});

describe('CustomerAgendaTypeOrmReader', () => {
  it('returns the complete aggregate with exactly one DataSource query', async () => {
    const source = { query: jest.fn(async () => [{ ...response, summary: JSON.stringify(response.summary), items: JSON.stringify(response.items) }]) };
    const result = await new CustomerAgendaTypeOrmReader(source as never).read({ assignmentStatus: 'ALL', page: 2, pageSize: 20 }, { kind: 'ALL' });
    expect(source.query).toHaveBeenCalledTimes(1);
    expect(source.query).toHaveBeenCalledWith(CUSTOMER_AGENDA_SQL, [null, null, null, null, null, null, 'ALL', 20, 2, null]);
    expect(result).toEqual({ ...response, pagination: response.pagination });
  });

  it('binds collector scope from the authenticated user as the final SQL parameter', async () => {
    const source = { query: jest.fn(async () => [response]) };
    await new CustomerAgendaTypeOrmReader(source as never).read({ collectorId: '11111111-1111-4111-8111-111111111111',
      routeId: '22222222-2222-4222-8222-222222222222', search: 'Ana', assignmentStatus: 'ALL', page: 1, pageSize: 20 },
    { kind: 'COLLECTOR', collectorUserId: '33333333-3333-4333-8333-333333333333' });
    expect(source.query).toHaveBeenCalledWith(CUSTOMER_AGENDA_SQL, ['Ana', '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222', null, null, null, 'ALL', 20, 1, '33333333-3333-4333-8333-333333333333']);
  });

  it('encodes the active-loan universe, strict counts, filtering and deterministic order', () => {
    expect(CUSTOMER_AGENDA_SQL).toContain("WHERE loan.status = 'ACTIVE'");
    expect(CUSTOMER_AGENDA_SQL).toContain('GROUP BY loan.customer_id');
    expect(CUSTOMER_AGENDA_SQL).not.toContain('customer.is_active');
    expect(CUSTOMER_AGENDA_SQL).toContain("COUNT(*) FILTER (WHERE assignment_status <> 'ASSIGNED')");
    expect(CUSTOMER_AGENDA_SQL).toContain("assignment_status = 'WITHOUT_ROUTE'");
    expect(CUSTOMER_AGENDA_SQL).toContain("assignment_status = 'WITHOUT_COLLECTOR'");
    expect(CUSTOMER_AGENDA_SQL).toContain('collector_user.is_active IS DISTINCT FROM true');
    expect(CUSTOMER_AGENDA_SQL).toContain("collector_role.code IS DISTINCT FROM 'COLLECTOR'");
    expect(CUSTOMER_AGENDA_SQL).toContain('LEFT JOIN LATERAL');
    expect(CUSTOMER_AGENDA_SQL).toContain('route.id AS route_id, route.name AS route_name');
    expect(CUSTOMER_AGENDA_SQL).toContain('CASE WHEN route.is_active = true AND collector.id IS NOT NULL');
    expect(CUSTOMER_AGENDA_SQL).toContain("$7::text = 'UNASSIGNED' AND item.assignment_status <> 'ASSIGNED'");
    expect(CUSTOMER_AGENDA_SQL).toContain("item.assignment_status = 'ASSIGNED' AND item.collector_id = $2::uuid");
    expect(CUSTOMER_AGENDA_SQL).toContain('item.route_id = $3::uuid');
    expect(CUSTOMER_AGENDA_SQL).toContain('item.collector_name ASC NULLS LAST');
    expect(CUSTOMER_AGENDA_SQL).toContain('GREATEST(1, LEAST($9::int');
    expect(CUSTOMER_AGENDA_SQL).toContain('SELECT effective_page FROM page_bounds');
  });

  it('applies the authenticated collector graph before search, filters, summaries and pagination', () => {
    const scope = CUSTOMER_AGENDA_SQL.slice(CUSTOMER_AGENDA_SQL.indexOf('classified AS'), CUSTOMER_AGENDA_SQL.indexOf('filtered AS'));
    expect(scope).toContain('customer_assignment.ended_at IS NULL');
    expect(scope).toContain('collector_assignment.ended_at IS NULL');
    expect(scope).toContain('collector_assignment.collector_user_id = $10::uuid');
    expect(scope).toContain('route.is_active = true');
    expect(scope).toContain('collector.is_active = true');
    expect(scope).toContain('collector_user.is_active = true');
    expect(scope).toContain("collector_role.code = 'COLLECTOR'");
    expect(CUSTOMER_AGENDA_SQL.indexOf('filtered AS')).toBeLessThan(CUSTOMER_AGENDA_SQL.indexOf('stats AS'));
    expect(CUSTOMER_AGENDA_SQL).toContain('FROM filtered');
  });

  it('keeps authoritative options outside page and exposes only valid collectors and active routes', () => {
    expect(CUSTOMER_AGENDA_SQL.indexOf('collector_options AS')).toBeGreaterThan(CUSTOMER_AGENDA_SQL.indexOf('page AS'));
    expect(CUSTOMER_AGENDA_SQL).toContain("collector_role.code = 'COLLECTOR'");
    expect(CUSTOMER_AGENDA_SQL).toContain('WHERE collector.is_active = true');
    expect(CUSTOMER_AGENDA_SQL).toContain('WHERE route.is_active = true');
    expect(CUSTOMER_AGENDA_SQL).toContain("'collectorId', collector_id");
    expect(CUSTOMER_AGENDA_SQL).toContain('collector_user.id = $10::uuid');
    expect(CUSTOMER_AGENDA_SQL).toContain('collector_assignment.collector_user_id = $10::uuid');
    expect(CUSTOMER_AGENDA_SQL).toContain("'provinces'");
    expect(CUSTOMER_AGENDA_SQL).toContain('FROM classified WHERE province_code IS NOT NULL');
  });
});
