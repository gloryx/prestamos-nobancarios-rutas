import { costaRicaDateOnly, formatDateOnlyForDisplay, shiftDateOnly } from '../../shared/utils/date';
import { normalizeMoney, parseMoneyCents } from '../../shared/utils/money';
import { interpretApplicationError } from '../../application/errors/application-error';
import type { ApplicationFieldError } from '../../application/errors/application-error';

export type RetryKeyState = { fingerprint: string; key: string };

export const createIdempotencyKey = (): string => globalThis.crypto?.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(16).slice(2)}`;

/** Keeps the same key for an unchanged request, including after an uncertain network result. */
export function retryKeyFor(payload: unknown, previous?: RetryKeyState): RetryKeyState {
  const fingerprint = JSON.stringify(payload);
  return previous?.fingerprint === fingerprint ? previous : { fingerprint, key: createIdempotencyKey() };
}

export function positiveMoney(value: string): string {
  const normalized = normalizeMoney(value);
  const cents = normalized ? parseMoneyCents(normalized) : null;
  return cents !== null && cents > 0n ? normalized : '';
}

export function nonNegativeMoney(value: string): string {
  const normalized = normalizeMoney(value);
  const cents = normalized ? parseMoneyCents(normalized) : null;
  return cents !== null && cents >= 0n ? normalized : '';
}

export function allowedOperationalDate(value: string, today = costaRicaDateOnly()): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value <= today;
}

export function validatePrecollectionCapture(input: { amount: string; effectiveDate: string; paymentMethodId: string }, busy = false): ApplicationFieldError[] {
  if (busy) return [{ field: 'submission', codes: ['BUSY'], message: 'El registro ya está en proceso.' }];
  const errors: ApplicationFieldError[] = [];
  if (!positiveMoney(input.amount)) errors.push({ field: 'amount', codes: ['INVALID'], message: 'Ingresá un monto mayor que cero.' });
  if (!allowedOperationalDate(input.effectiveDate)) errors.push({ field: 'effectiveDate', codes: ['INVALID'], message: 'La fecha no puede ser futura.' });
  if (!input.paymentMethodId) errors.push({ field: 'paymentMethodId', codes: ['REQUIRED'], message: 'Seleccioná una forma de pago.' });
  return errors;
}

export function dayNavigation(date: string, today = costaRicaDateOnly()) {
  return { previous: shiftDateOnly(date, -1), next: date < today ? shiftDateOnly(date, 1) : null, today };
}

export function collectorPrecollectionEmptyMessage(date: string): string {
  return `No hay cobros registrados para el ${formatDateOnlyForDisplay(date)}.`;
}

export async function runLatestRequest<T>(
  execute: () => Promise<T>,
  isLatest: () => boolean,
  onSuccess: (value: T) => void,
  onError: (cause: unknown) => void,
  onSettled: () => void,
): Promise<void> {
  try {
    const value = await execute();
    if (isLatest()) onSuccess(value);
  } catch (cause) {
    if (isLatest()) onError(cause);
  } finally {
    if (isLatest()) onSettled();
  }
}

export function errorMessage(cause: unknown, fallback: string): string {
  return interpretApplicationError(cause, fallback).message;
}

export const precollectionStatusLabel: Record<string, string> = {
  RECORDED: 'Registrado', SUBMITTED: 'En liquidación', SETTLED: 'Liquidado', REJECTED: 'Rechazado', CANCELLED: 'Cancelado',
};

export const settlementStatusLabel: Record<string, string> = {
  DRAFT: 'Borrador', SUBMITTED: 'Enviado', UNDER_REVIEW: 'En revisión', CONFIRMED: 'Confirmado', REJECTED: 'Rechazado', CANCELLED: 'Cancelado',
};
