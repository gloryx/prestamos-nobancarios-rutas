import { parseMoneyCents } from '../../shared/utils/money';

type CashMovementForm = { amount: string; movementDate: string; paymentMethodId: string };
export type CashMovementFieldErrors = Partial<Record<'amount' | 'movementDate' | 'paymentMethodId', string>>;
export type CashReversalFieldErrors = Partial<Record<'movementDate' | 'reason', string>>;

export function cashMovementFieldErrors(form: CashMovementForm, methods: Array<{ id: string; isActive: boolean }>,
  today = new Date().toISOString().slice(0, 10)): CashMovementFieldErrors {
  const errors: CashMovementFieldErrors = {};
  const amount = parseMoneyCents(form.amount);
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(form.movementDate) ? new Date(`${form.movementDate}T00:00:00Z`) : null;
  if (amount === null || amount <= 0n) errors.amount = 'Ingresa un importe mayor que cero y con hasta dos decimales.';
  if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== form.movementDate || form.movementDate > today)
    errors.movementDate = 'Selecciona una fecha válida que no esté en el futuro.';
  if (!methods.some((method) => method.id === form.paymentMethodId && method.isActive))
    errors.paymentMethodId = 'Selecciona una forma de pago activa para continuar.';
  return errors;
}

export function cashMovementFormErrors(form: CashMovementForm, methods: Array<{ id: string; isActive: boolean }>,
  today = new Date().toISOString().slice(0, 10)): string[] {
  return Object.values(cashMovementFieldErrors(form, methods, today));
}

export function cashReversalFieldErrors(movementDate: string, reason: string, originalDate: string,
  today = new Date().toISOString().slice(0, 10)): CashReversalFieldErrors {
  const errors: CashReversalFieldErrors = {};
  if (!reason.trim()) errors.reason = 'Indica el motivo de la reversión para continuar.';
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(movementDate) ? new Date(`${movementDate}T00:00:00Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== movementDate || movementDate < originalDate || movementDate > today)
    errors.movementDate = 'Selecciona una fecha válida, no anterior al movimiento ni futura.';
  return errors;
}

export function cashReversalError(movementDate: string, reason: string, originalDate: string,
  today = new Date().toISOString().slice(0, 10)): string | null {
  return Object.values(cashReversalFieldErrors(movementDate, reason, originalDate, today))[0] ?? null;
}
