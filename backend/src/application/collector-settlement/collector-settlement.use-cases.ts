import { createHash } from 'crypto';
import type { CurrentIdentity } from '../../domain/security/security.types';
import { CollectorSettlementForbiddenError, CollectorSettlementNotFoundError,
  CollectorSettlementValidationError } from '../../domain/collector-settlement/collector-settlement.errors';
import type { CollectorSettlementClock, CollectorSettlementStore, ConfirmCollectorSettlementCommand,
  CreateCollectorSettlementCommand } from './collector-settlement.ports';
import { isStrictDate } from '../../domain/collector-precollection/collector-precollection.rules';

export const COLLECTOR_SETTLEMENT_STORE = Symbol('COLLECTOR_SETTLEMENT_STORE');
export const COLLECTOR_SETTLEMENT_CLOCK = Symbol('COLLECTOR_SETTLEMENT_CLOCK');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;
const can = (actor: CurrentIdentity, permission: string) => actor.role.isSuperAdmin || actor.permissions.includes(permission);
const fp = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key = (value: string) => {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 128) throw new CollectorSettlementValidationError('La clave de idempotencia es obligatoria.', 'IDEMPOTENCY_KEY_INVALID', 'idempotencyKey');
  return normalized;
};
const reason = (value?: string | null) => {
  const normalized = value?.trim() || null;
  if (!normalized || normalized.length > 500) throw new CollectorSettlementValidationError('Indica un motivo de hasta 500 caracteres.', 'REASON_INVALID', 'reason');
  return normalized;
};

export class CreateCollectorSettlementUseCase {
  constructor(private readonly store: CollectorSettlementStore) {}
  execute(input: CreateCollectorSettlementCommand, actor: CurrentIdentity) {
    if (!Array.isArray(input.precollectionIds) || !input.precollectionIds.length
      || input.precollectionIds.some((id) => !UUID.test(id)) || new Set(input.precollectionIds).size !== input.precollectionIds.length) {
      throw new CollectorSettlementValidationError('Selecciona cobros preliminares válidos y sin duplicados.', 'PRECOLLECTIONS_INVALID', 'precollectionIds');
    }
    if (input.collectorId && !UUID.test(input.collectorId)) throw new CollectorSettlementValidationError('El cobrador no es válido.', 'COLLECTOR_INVALID', 'collectorId');
    const allowGlobal = can(actor, 'collector-settlements.create');
    if (!allowGlobal && !can(actor, 'collector-settlements.self.create')) throw new CollectorSettlementForbiddenError('No tienes permiso para crear liquidaciones.');
    if (input.collectorId && !allowGlobal) throw new CollectorSettlementForbiddenError('Solo puedes crear liquidaciones propias.');
    const command = { ...input, precollectionIds: [...input.precollectionIds].sort(), idempotencyKey: key(input.idempotencyKey) };
    return this.store.create(command, actor.id, allowGlobal, fp(command));
  }
}

export class ListCollectorSettlementsUseCase {
  constructor(private readonly store: CollectorSettlementStore) {}
  execute(actor: CurrentIdentity, mine: boolean) {
    if (mine) {
      if (!can(actor, 'collector-settlements.self.view')) throw new CollectorSettlementForbiddenError('No tienes permiso para consultar tus liquidaciones.');
      return this.store.list(actor.id);
    }
    if (!can(actor, 'collector-settlements.view')) throw new CollectorSettlementForbiddenError('No tienes permiso para consultar liquidaciones.');
    return this.store.list();
  }
}

export class ListCollectorSettlementDeliveryMethodsUseCase {
  constructor(private readonly store: CollectorSettlementStore) {}
  execute() { return this.store.activeDeliveryMethods(); }
}

export class ListEligibleCollectorPrecollectionsUseCase {
  constructor(private readonly store: CollectorSettlementStore) {}
  execute(query: { page: number; pageSize: number }, actor: CurrentIdentity) {
    if (!can(actor, 'collector-settlements.self.view')) {
      throw new CollectorSettlementForbiddenError('No tienes permiso para consultar cobros elegibles.');
    }
    if (!Number.isSafeInteger(query.page) || query.page < 1 || !Number.isSafeInteger(query.pageSize)
      || query.pageSize < 1 || query.pageSize > 50) {
      throw new CollectorSettlementValidationError('La paginación no es válida.', 'PAGINATION_INVALID');
    }
    return this.store.eligible(actor.id, query);
  }
}

export class GetCollectorSettlementUseCase {
  constructor(private readonly store: CollectorSettlementStore) {}
  async execute(id: string, actor: CurrentIdentity) {
    const global = can(actor, 'collector-settlements.view');
    if (!global && !can(actor, 'collector-settlements.self.view')) throw new CollectorSettlementForbiddenError('No tienes permiso para consultar la liquidación.');
    const result = await this.store.detail(id, global ? undefined : actor.id);
    if (!result) throw new CollectorSettlementNotFoundError('La liquidación no existe o no está disponible.');
    return result;
  }
}

export class TransitionCollectorSettlementUseCase {
  constructor(private readonly store: CollectorSettlementStore) {}
  execute(id: string, action: 'submit' | 'review' | 'reject' | 'cancel', input: { reason?: string; idempotencyKey: string }, actor: CurrentIdentity) {
    const selfPermission = `collector-settlements.self.${action}`;
    const globalPermission = `collector-settlements.${action}`;
    const allowGlobal = can(actor, globalPermission);
    if (!allowGlobal && !can(actor, selfPermission)) throw new CollectorSettlementForbiddenError('No tienes permiso para realizar esta acción.');
    const normalizedReason = action === 'reject' || action === 'cancel' ? reason(input.reason) : null;
    const idempotencyKey = key(input.idempotencyKey);
    return this.store.transition(id, action, normalizedReason, idempotencyKey,
      fp({ id, action, reason: normalizedReason }), actor.id, allowGlobal);
  }
}

export class ConfirmCollectorSettlementUseCase {
  constructor(private readonly store: CollectorSettlementStore, private readonly clock: CollectorSettlementClock) {}
  execute(id: string, input: ConfirmCollectorSettlementCommand, actor: CurrentIdentity) {
    if (!can(actor, 'collector-settlements.confirm')) throw new CollectorSettlementForbiddenError('No tienes permiso para confirmar liquidaciones.');
    if (!MONEY.test(input.amountDelivered) || !isStrictDate(input.deliveryDate) || input.deliveryDate > this.clock.today()) {
      throw new CollectorSettlementValidationError('El monto o la fecha de entrega no son válidos.', 'DELIVERY_INVALID');
    }
    const amountDelivered = `${input.amountDelivered.split('.')[0]}.${(input.amountDelivered.split('.')[1] ?? '').padEnd(2, '0')}`;
    const deliveryPaymentMethodId = input.deliveryPaymentMethodId || null;
    if (amountDelivered !== '0.00' && (!deliveryPaymentMethodId || !UUID.test(deliveryPaymentMethodId))) {
      throw new CollectorSettlementValidationError('Selecciona la forma de entrega a la empresa.', 'DELIVERY_METHOD_REQUIRED', 'deliveryPaymentMethodId');
    }
    const command = { ...input, amountDelivered, deliveryPaymentMethodId,
      deliveryReference: input.deliveryReference?.trim() || null, deliveryNotes: input.deliveryNotes?.trim() || null,
      idempotencyKey: key(input.idempotencyKey) };
    return this.store.confirm(id, command, fp({ id, ...command }), actor.id);
  }
}
