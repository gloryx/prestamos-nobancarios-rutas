import { createHash } from 'crypto';
import type { CurrentIdentity } from '../../domain/security/security.types';
import { CollectorCustodyForbiddenError, CollectorCustodyValidationError } from '../../domain/collector-custody/collector-custody.errors';
import type { CollectorCustodyClock, CollectorCustodyCommand, CollectorCustodyStore } from './collector-custody.ports';
import { isStrictDate } from '../../domain/collector-precollection/collector-precollection.rules';

export const COLLECTOR_CUSTODY_STORE = Symbol('COLLECTOR_CUSTODY_STORE');
export const COLLECTOR_CUSTODY_CLOCK = Symbol('COLLECTOR_CUSTODY_CLOCK');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;
const can = (actor: CurrentIdentity, permission: string) => actor.role.isSuperAdmin || actor.permissions.includes(permission);

export class ViewCollectorCustodyUseCase {
  constructor(private readonly store: CollectorCustodyStore) {}
  summary(collectorId: string | undefined, actor: CurrentIdentity) {
    const global = this.assertScope(collectorId, actor);
    return this.store.summary(actor.id, collectorId, global);
  }
  history(collectorId: string | undefined, actor: CurrentIdentity) {
    const global = this.assertScope(collectorId, actor);
    return this.store.history(actor.id, collectorId, global);
  }
  private assertScope(collectorId: string | undefined, actor: CurrentIdentity) {
    if (collectorId && !UUID.test(collectorId)) throw new CollectorCustodyValidationError('El cobrador no es válido.', 'COLLECTOR_INVALID', 'collectorId');
    const global = can(actor, 'collector-custody.view');
    if (!global && !can(actor, 'collector-custody.self.view')) throw new CollectorCustodyForbiddenError('No tienes permiso para consultar la custodia.');
    if (collectorId && !global) throw new CollectorCustodyForbiddenError('Solo puedes consultar tu propia custodia.');
    return global;
  }
}

export class RecordCollectorCustodyUseCase {
  constructor(private readonly store: CollectorCustodyStore, private readonly clock: CollectorCustodyClock) {}
  execute(kind: 'remittance' | 'topup' | 'adjustment', input: CollectorCustodyCommand, actor: CurrentIdentity) {
    const globalPermission = `collector-custody.${kind === 'adjustment' ? 'adjust' : kind === 'remittance' ? 'remit' : 'topup'}`;
    const selfPermission = kind === 'remittance' ? 'collector-custody.self.remit' : '';
    const global = can(actor, globalPermission);
    if (!global && (!selfPermission || !can(actor, selfPermission))) throw new CollectorCustodyForbiddenError('No tienes permiso para registrar este movimiento.');
    if (input.collectorId && (!UUID.test(input.collectorId) || !global)) throw new CollectorCustodyForbiddenError('No puedes registrar movimientos para ese cobrador.');
    if (!MONEY.test(input.amount) || BigInt(input.amount.replace('.', '')) <= 0n || !isStrictDate(input.effectiveDate)
      || input.effectiveDate > this.clock.today() || !UUID.test(input.paymentMethodId ?? '')) {
      throw new CollectorCustodyValidationError('Revisa el monto, la fecha y la forma de pago.', 'MOVEMENT_INVALID');
    }
    if (!input.reference?.trim() || input.reference.trim().length > 200 || !input.reason?.trim() || input.reason.trim().length > 500
      || !input.idempotencyKey?.trim() || input.idempotencyKey.trim().length > 128
      || kind === 'adjustment' && !['CREDIT', 'DEBIT'].includes(input.direction ?? '')) {
      throw new CollectorCustodyValidationError('La referencia, el motivo o la clave de idempotencia no son válidos.', 'MOVEMENT_AUDIT_INVALID');
    }
    const command = { ...input, amount: `${input.amount.split('.')[0]}.${(input.amount.split('.')[1] ?? '').padEnd(2, '0')}`,
      reference: input.reference.trim(), reason: input.reason.trim(), notes: input.notes?.trim() || null,
      idempotencyKey: input.idempotencyKey.trim() };
    const fingerprint = createHash('sha256').update(JSON.stringify({ kind, ...command })).digest('hex');
    return this.store.record(kind, command, fingerprint, actor.id, global);
  }
}
