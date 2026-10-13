import { ApiConnectionError } from './application-error';

const reasonMessages: Record<string, string> = {
  CLOSED_FINANCIAL_PERIOD: 'La fecha pertenece a un período financiero cerrado. Selecciona otra fecha permitida para continuar.',
  EFFECTIVE_DATE_BEFORE_REFINANCING: 'La fecha efectiva no puede ser anterior al refinanciamiento. Corrige la fecha para continuar.',
  EFFECTIVE_DATE_IN_FUTURE: 'La fecha efectiva no puede estar en el futuro. Corrige la fecha para continuar.',
  PAYMENT_REVERSAL_AFTER_EFFECTIVE_DATE: 'Existe una reversión de pago posterior a la fecha efectiva. Selecciona otra fecha o revisa el historial.',
  ACTIVE_CHILD_REFINANCING: 'El préstamo sucesor tiene un refinanciamiento posterior activo que bloquea la anulación.',
  REFINANCING_NOT_CONFIRMED: 'El refinanciamiento no está confirmado y no puede anularse.',
  ORIGIN_NOT_REFINANCED: 'El préstamo origen ya no figura como refinanciado. Actualiza la información antes de continuar.',
  SUCCESSOR_NOT_ACTIVE: 'El préstamo sucesor ya no está activo. Actualiza la información antes de continuar.',
  VALID_SUCCESSOR_PAYMENT: 'El préstamo sucesor tiene pagos válidos. Revisa esos pagos antes de anular el refinanciamiento.',
  CASH_REFUND_PAYMENT_INCOMPATIBLE: 'La devolución no es compatible con los pagos del préstamo sucesor. Revisa el historial antes de continuar.',
  INCONSISTENT_ANNULLED_PAYMENT: 'Existe un pago anulado que no está completamente conciliado. Contacta a soporte.',
  INCONSISTENT_PAYMENT_PLANS: 'Los planes de pago no concilian con el refinanciamiento. Contacta a soporte.',
  INCONSISTENT_NEW_MONEY: 'El desembolso de dinero nuevo no concilia con Caja. Contacta a soporte.',
  IDEMPOTENCY_CONFLICT: 'La solicitud ya fue utilizada con datos diferentes. Actualiza la información antes de reintentar.',
  REFINANCING_ANNULMENT_CONFLICT: 'La elegibilidad cambió mientras realizabas la operación. Revisa los datos actualizados.',
};

export function refinancingAnnulmentReasonMessage(code: string): string {
  return reasonMessages[code] ?? 'Esta modalidad está bloqueada por el estado actual del refinanciamiento.';
}

export function refinancingAnnulmentErrorMessage(cause: unknown, fallback: string): string {
  const value = typeof cause === 'object' && cause !== null ? cause as { status?: unknown; reasonCode?: unknown } : {};
  if (typeof value.reasonCode === 'string' && reasonMessages[value.reasonCode]) return reasonMessages[value.reasonCode];
  if (value.status === 403) return 'No tienes permiso para realizar esta operación.';
  if (value.status === 404) return 'El refinanciamiento ya no está disponible. Actualiza la lista para continuar.';
  if (value.status === 409) return reasonMessages.REFINANCING_ANNULMENT_CONFLICT;
  if (cause instanceof ApiConnectionError || cause instanceof TypeError)
    return 'No se pudo conectar con el servidor. Conservamos los datos para que puedas reintentar.';
  return fallback;
}
