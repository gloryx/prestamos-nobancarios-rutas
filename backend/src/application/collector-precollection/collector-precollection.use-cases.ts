import type { CurrentIdentity } from '../../domain/security/security.types';
import {
  CollectorPrecollectionForbiddenError,
  CollectorPrecollectionNotFoundError,
  CollectorPrecollectionValidationError,
} from '../../domain/collector-precollection/collector-precollection.errors';
import { COLLECTOR_PRECOLLECTION_STATUSES } from '../../domain/collector-precollection/collector-precollection.types';
import type { CollectorPrecollectionStatus } from '../../domain/collector-precollection/collector-precollection.types';
import {
  cancellationFingerprint,
  collectorPrecollectionFingerprint,
  isStrictDate,
  normalizeCollectorPrecollectionInput,
  type CreateCollectorPrecollectionInput,
} from '../../domain/collector-precollection/collector-precollection.rules';
import type {
  CollectorPrecollectionClock,
  CollectorPrecollectionListQuery,
  CollectorPrecollectionSort,
  CollectorPrecollectionStore,
} from './collector-precollection.ports';

export const COLLECTOR_PRECOLLECTION_STORE = Symbol('COLLECTOR_PRECOLLECTION_STORE');
export const COLLECTOR_PRECOLLECTION_CLOCK = Symbol('COLLECTOR_PRECOLLECTION_CLOCK');

type RawListQuery = Partial<Omit<CollectorPrecollectionListQuery, 'fromDate' | 'toDate' | 'page' | 'pageSize' | 'sortBy' | 'sortDir'>> & {
  date?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: string;
};

const SORTS = new Set<CollectorPrecollectionSort>(['effectiveDate', 'recordedAt', 'amount', 'status', 'customer', 'loanNumber']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hasPermission = (actor: CurrentIdentity, permission: string) => actor.role.isSuperAdmin || actor.permissions.includes(permission);

function normalizeQuery(query: RawListQuery, today: string): CollectorPrecollectionListQuery {
  if (query.date && (query.fromDate || query.toDate)) {
    throw new CollectorPrecollectionValidationError('Usa una fecha exacta o un período, no ambos.', 'QUERY_DATE_RANGE_CONFLICT', 'date');
  }
  const fromDate = query.fromDate ?? query.date ?? today;
  const toDate = query.toDate ?? query.date ?? today;
  if (!isStrictDate(fromDate) || !isStrictDate(toDate) || fromDate > toDate || toDate > today) {
    throw new CollectorPrecollectionValidationError('La fecha de consulta no es válida ni puede ser futura.', 'QUERY_DATE_INVALID', 'date');
  }
  if (query.status && !COLLECTOR_PRECOLLECTION_STATUSES.includes(query.status as CollectorPrecollectionStatus)) {
    throw new CollectorPrecollectionValidationError('El estado solicitado no es válido.', 'STATUS_INVALID', 'status');
  }
  if (query.paymentMethodId && !UUID.test(query.paymentMethodId)) {
    throw new CollectorPrecollectionValidationError('La forma de pago no es válida.', 'PAYMENT_METHOD_INVALID', 'paymentMethodId');
  }
  if (query.collectorId && !UUID.test(query.collectorId)) {
    throw new CollectorPrecollectionValidationError('El cobrador no es válido.', 'COLLECTOR_INVALID', 'collectorId');
  }
  if (query.routeId && !UUID.test(query.routeId)) {
    throw new CollectorPrecollectionValidationError('La ruta no es válida.', 'ROUTE_INVALID', 'routeId');
  }
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new CollectorPrecollectionValidationError('La paginación no es válida.', 'PAGINATION_INVALID');
  }
  const sortBy = (query.sortBy ?? 'effectiveDate') as CollectorPrecollectionSort;
  const sortDir = query.sortDir ?? 'asc';
  if (!SORTS.has(sortBy) || !['asc', 'desc'].includes(sortDir)) {
    throw new CollectorPrecollectionValidationError('El orden solicitado no es válido.', 'SORT_INVALID');
  }
  const search = query.search?.trim();
  if (search && search.length > 200) {
    throw new CollectorPrecollectionValidationError('La búsqueda no puede superar 200 caracteres.', 'SEARCH_TOO_LONG', 'search');
  }
  return { fromDate, toDate, status: query.status, paymentMethodId: query.paymentMethodId,
    collectorId: query.collectorId, routeId: query.routeId, search: search || undefined,
    page, pageSize, sortBy, sortDir: sortDir as 'asc' | 'desc' };
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export class CreateCollectorPrecollectionUseCase {
  constructor(private readonly store: CollectorPrecollectionStore, private readonly clock: CollectorPrecollectionClock) {}
  execute(input: CreateCollectorPrecollectionInput, actor: CurrentIdentity) {
    const normalized = normalizeCollectorPrecollectionInput(input, this.clock.today());
    return this.store.create(normalized, actor.id, collectorPrecollectionFingerprint(normalized));
  }
}

export class ListMyCollectorPrecollectionsUseCase {
  constructor(private readonly store: CollectorPrecollectionStore, private readonly clock: CollectorPrecollectionClock) {}
  async execute(query: RawListQuery, actor: CurrentIdentity) {
    const today = this.clock.today();
    const normalized = normalizeQuery(query, today);
    const page = await this.store.list(normalized, actor.id);
    if (normalized.fromDate === normalized.toDate) page.navigation = { selectedDate: normalized.fromDate, today,
      previousDate: shiftDate(normalized.fromDate, -1), nextDate: normalized.fromDate === today ? null : shiftDate(normalized.fromDate, 1) };
    return page;
  }
}

export class ListCollectorPrecollectionsUseCase {
  constructor(private readonly store: CollectorPrecollectionStore, private readonly clock: CollectorPrecollectionClock) {}
  execute(query: RawListQuery) { return this.store.list(normalizeQuery(query, this.clock.today())); }
}

export class GetCollectorPrecollectionDetailUseCase {
  constructor(private readonly store: CollectorPrecollectionStore) {}
  async execute(id: string, actor: CurrentIdentity) {
    const global = hasPermission(actor, 'collector-precollections.view');
    if (!global && !hasPermission(actor, 'collector-precollections.assigned.view')) {
      throw new CollectorPrecollectionForbiddenError('No tienes permiso para consultar este cobro preliminar.');
    }
    const detail = await this.store.detail(id, global ? undefined : actor.id);
    if (!detail) throw new CollectorPrecollectionNotFoundError('El cobro preliminar no existe o no está disponible.');
    return detail;
  }
}

export class CancelCollectorPrecollectionUseCase {
  constructor(private readonly store: CollectorPrecollectionStore) {}
  execute(id: string, reason: string, idempotencyKey: string, actor: CurrentIdentity) {
    const normalizedReason = reason?.trim();
    const normalizedKey = idempotencyKey?.trim();
    if (!normalizedReason || normalizedReason.length > 500) {
      throw new CollectorPrecollectionValidationError('Indica un motivo de cancelación de hasta 500 caracteres.', 'CANCELLATION_REASON_INVALID', 'reason');
    }
    if (!normalizedKey || normalizedKey.length > 128) {
      throw new CollectorPrecollectionValidationError('La clave de idempotencia es obligatoria.', 'IDEMPOTENCY_KEY_INVALID', 'idempotencyKey');
    }
    const allowGlobal = hasPermission(actor, 'collector-precollections.view');
    return this.store.cancel(id, normalizedReason, normalizedKey, cancellationFingerprint(id, normalizedReason),
      actor.id, allowGlobal);
  }
}
