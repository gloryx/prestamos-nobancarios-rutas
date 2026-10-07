import { CustomerValidationError } from '../../domain/customer/customer.errors';
import type { CurrentIdentity } from '../../domain/security/security.types';

export type CustomerAgendaAssignmentStatus =
  | 'ASSIGNED'
  | 'WITHOUT_ROUTE'
  | 'WITHOUT_COLLECTOR'
  | 'INVALID_ROUTE'
  | 'INVALID_COLLECTOR';
export type CustomerAgendaAssignmentFilter = 'ALL' | 'ASSIGNED' | 'UNASSIGNED';

export type CustomerAgendaQuery = {
  search?: string;
  collectorId?: string;
  routeId?: string;
  provinceCode?: number;
  cantonCode?: number;
  districtCode?: number;
  assignmentStatus?: CustomerAgendaAssignmentFilter;
  page?: number;
  pageSize?: 10 | 20 | 50;
};

export type ValidCustomerAgendaQuery = {
  search?: string;
  collectorId?: string;
  routeId?: string;
  provinceCode?: number;
  cantonCode?: number;
  districtCode?: number;
  assignmentStatus: CustomerAgendaAssignmentFilter;
  page: number;
  pageSize: 10 | 20 | 50;
};

export type CustomerAgendaItem = {
  customerId: string;
  customerName: string;
  identification: string;
  primaryPhone: string | null;
  activeLoanCount: number;
  assignmentStatus: CustomerAgendaAssignmentStatus;
  route: { id: string; name: string } | null;
  collector: { id: string; name: string } | null;
  territory: {
    provinceCode: number;
    provinceName: string;
    cantonCode: number;
    cantonName: string;
    districtCode: number;
    districtName: string;
  } | null;
};

export type CustomerAgendaResponse = {
  summary: {
    total: number;
    assigned: number;
    unassigned: number;
    withoutRoute: number;
    routeWithoutCollector: number;
    invalidRoute: number;
    invalidCollector: number;
  };
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  options: {
    collectors: { id: string; name: string }[];
    routes: { id: string; name: string; collectorId: string | null }[];
    provinces: { code: number; name: string }[];
    cantons: { code: number; name: string; provinceCode: number }[];
    districts: { code: number; name: string; cantonCode: number }[];
  };
  items: CustomerAgendaItem[];
};

export const CUSTOMER_AGENDA_READER = Symbol('CUSTOMER_AGENDA_READER');

export type CustomerAgendaScope =
  | { kind: 'ALL' }
  | { kind: 'COLLECTOR'; collectorUserId: string };

export interface CustomerAgendaReader {
  read(query: ValidCustomerAgendaQuery, scope: CustomerAgendaScope): Promise<CustomerAgendaResponse>;
}

export class CustomerAgendaForbiddenError extends Error {}

export type CustomerAgendaAssignmentFacts = {
  hasCurrentRouteAssignment: boolean;
  routeExists: boolean;
  routeActive: boolean;
  hasCurrentCollectorAssignment: boolean;
  collectorExists: boolean;
  collectorActive: boolean;
  userActive: boolean;
  roleActive: boolean;
  collectorRole: boolean;
};

export const classifyCustomerAgendaAssignment = (facts: CustomerAgendaAssignmentFacts): CustomerAgendaAssignmentStatus => {
  if (!facts.hasCurrentRouteAssignment) return 'WITHOUT_ROUTE';
  if (!facts.routeExists || !facts.routeActive) return 'INVALID_ROUTE';
  if (!facts.hasCurrentCollectorAssignment) return 'WITHOUT_COLLECTOR';
  if (!facts.collectorExists || !facts.collectorActive || !facts.userActive || !facts.roleActive || !facts.collectorRole)
    return 'INVALID_COLLECTOR';
  return 'ASSIGNED';
};

const positiveInteger = (value: number | undefined, label: string): void => {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1))
    throw new CustomerValidationError(`${label} debe ser un entero positivo.`);
};

export class CustomerAgendaUseCase {
  constructor(private readonly reader: CustomerAgendaReader) {}

  async execute(query: CustomerAgendaQuery = {}, actor: CurrentIdentity): Promise<CustomerAgendaResponse> {
    positiveInteger(query.page, 'La página');
    positiveInteger(query.provinceCode, 'La provincia');
    positiveInteger(query.cantonCode, 'El cantón');
    positiveInteger(query.districtCode, 'El distrito');
    if (query.pageSize !== undefined && ![10, 20, 50].includes(query.pageSize))
      throw new CustomerValidationError('El tamaño de página debe ser 10, 20 o 50.');
    if (query.assignmentStatus !== undefined && !['ALL', 'ASSIGNED', 'UNASSIGNED'].includes(query.assignmentStatus))
      throw new CustomerValidationError('El estado de asignación no es válido.');
    const search = query.search?.trim();
    const collectorScoped = !actor.role.isSuperAdmin && actor.role.code === 'COLLECTOR';
    if (collectorScoped && !actor.permissions.includes('customers.assigned.view'))
      throw new CustomerAgendaForbiddenError('No tiene permiso para consultar clientes asignados.');
    if (!collectorScoped && !actor.role.isSuperAdmin && !actor.permissions.includes('customers.view'))
      throw new CustomerAgendaForbiddenError('No tiene permiso para consultar la agenda global de clientes.');
    const scope: CustomerAgendaScope = collectorScoped
      ? { kind: 'COLLECTOR', collectorUserId: actor.id }
      : { kind: 'ALL' };
    return this.reader.read({
      ...(search && { search }),
      ...(query.collectorId && { collectorId: query.collectorId }),
      ...(query.routeId && { routeId: query.routeId }),
      ...(query.provinceCode !== undefined && { provinceCode: query.provinceCode }),
      ...(query.cantonCode !== undefined && { cantonCode: query.cantonCode }),
      ...(query.districtCode !== undefined && { districtCode: query.districtCode }),
      assignmentStatus: query.assignmentStatus ?? 'ALL',
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
    }, scope);
  }
}
