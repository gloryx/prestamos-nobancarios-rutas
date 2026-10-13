import { CollectorPrecollectionValidationError } from './collector-precollection.errors';
import { COLLECTOR_CUSTODY_TREATMENTS, type CollectorCustodyTreatment } from './collector-precollection.types';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CreateCollectorPrecollectionInput = {
  customerId: string;
  loanId: string;
  paymentMethodId: string;
  custodyTreatment: CollectorCustodyTreatment;
  amount: string;
  effectiveDate: string;
  reference?: string | null;
  notes?: string | null;
  idempotencyKey: string;
};

export type NormalizedCollectorPrecollectionInput = Omit<CreateCollectorPrecollectionInput, 'reference' | 'notes'> & {
  reference: string | null;
  notes: string | null;
};

export const normalizeMoney = (value: string): string => {
  const [whole, fraction = ''] = value.split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
};

export function isStrictDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function normalizeCollectorPrecollectionInput(
  input: CreateCollectorPrecollectionInput,
  costaRicaToday: string,
): NormalizedCollectorPrecollectionInput {
  if (!input || !UUID.test(input.customerId ?? '')) {
    throw new CollectorPrecollectionValidationError('Selecciona un cliente válido.', 'CUSTOMER_INVALID', 'customerId');
  }
  if (!UUID.test(input.loanId ?? '')) {
    throw new CollectorPrecollectionValidationError('Selecciona un préstamo válido.', 'LOAN_INVALID', 'loanId');
  }
  if (!UUID.test(input.paymentMethodId ?? '')) {
    throw new CollectorPrecollectionValidationError('Selecciona una forma de pago válida.', 'PAYMENT_METHOD_INVALID', 'paymentMethodId');
  }
  if (!COLLECTOR_CUSTODY_TREATMENTS.includes(input.custodyTreatment)) {
    throw new CollectorPrecollectionValidationError('Indica quién recibió físicamente el dinero.', 'CUSTODY_TREATMENT_INVALID', 'custodyTreatment');
  }
  if (!isStrictDate(input.effectiveDate) || input.effectiveDate > costaRicaToday) {
    throw new CollectorPrecollectionValidationError('La fecha del cobro no es válida ni puede ser futura.', 'EFFECTIVE_DATE_INVALID', 'effectiveDate');
  }
  if (typeof input.amount !== 'string' || !MONEY.test(input.amount) || BigInt(input.amount.replace('.', '')) <= 0n) {
    throw new CollectorPrecollectionValidationError('El monto debe ser mayor que cero y tener hasta dos decimales.', 'AMOUNT_INVALID', 'amount');
  }
  const idempotencyKey = input.idempotencyKey?.trim();
  if (!idempotencyKey || idempotencyKey.length > 128) {
    throw new CollectorPrecollectionValidationError('La clave de idempotencia es obligatoria.', 'IDEMPOTENCY_KEY_INVALID', 'idempotencyKey');
  }
  const reference = input.reference?.trim() || null;
  if (reference && reference.length > 200) {
    throw new CollectorPrecollectionValidationError('La referencia no puede superar 200 caracteres.', 'REFERENCE_TOO_LONG', 'reference');
  }
  const notes = input.notes?.trim() || null;
  if (notes && notes.length > 1000) {
    throw new CollectorPrecollectionValidationError('Las observaciones no pueden superar 1000 caracteres.', 'NOTES_TOO_LONG', 'notes');
  }
  return { ...input, amount: normalizeMoney(input.amount), reference, notes, idempotencyKey };
}

export function collectorPrecollectionFingerprint(input: NormalizedCollectorPrecollectionInput): string {
  return JSON.stringify({ customerId: input.customerId, loanId: input.loanId, paymentMethodId: input.paymentMethodId,
    custodyTreatment: input.custodyTreatment, amount: input.amount, effectiveDate: input.effectiveDate,
    reference: input.reference, notes: input.notes });
}

export function cancellationFingerprint(precollectionId: string, reason: string): string {
  return JSON.stringify({ precollectionId, reason });
}
