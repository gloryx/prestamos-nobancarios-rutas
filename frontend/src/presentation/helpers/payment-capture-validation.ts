import type { PaymentContext } from '../../infrastructure/api/payment.api';
import { formatDateOnlyForDisplay } from '../../shared/utils/date';
import { parseMoneyCents } from '../../shared/utils/money';

export type PaymentCaptureField = 'paymentDate' | 'amount' | 'methodId' | 'collectorId';
export type PaymentCaptureFieldErrors = Partial<Record<PaymentCaptureField, string>>;

export function paymentCaptureFieldErrors(context: PaymentContext,
  values: { amount: string; paymentDate: string; methodId: string; collectorId: string },
  today = new Date().toISOString().slice(0, 10)): PaymentCaptureFieldErrors {
  const errors: PaymentCaptureFieldErrors = {};
  const cents = parseMoneyCents(values.amount);
  const balance = parseMoneyCents(context.balances.financialBalance);
  if (cents === null || cents <= 0n) errors.amount = 'Ingresa un monto mayor que cero.';
  else if (balance !== null && cents > balance) errors.amount = 'El monto no puede superar el saldo pendiente.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.paymentDate) || formatDateOnlyForDisplay(values.paymentDate) === '—')
    errors.paymentDate = 'Ingresa una fecha válida.';
  else if (values.paymentDate > today) errors.paymentDate = 'La fecha del pago no puede estar en el futuro.';
  if (!context.preferredMethod.activeMethods.some((method) => method.id === values.methodId))
    errors.methodId = 'Selecciona una forma de pago activa.';
  if (!context.preferredMethod.collectors.some((collector) => collector.id === values.collectorId))
    errors.collectorId = 'Selecciona un cobrador activo.';
  return errors;
}
