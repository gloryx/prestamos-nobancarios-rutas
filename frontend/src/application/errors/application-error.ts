export type ApplicationErrorKind = 'validation' | 'authentication' | 'permission' | 'not-found' |
  'conflict' | 'closed-period' | 'network' | 'unexpected';

export type ApplicationFieldError = { field: string; codes: string[]; message: string };
export type InterpretedApplicationError = {
  kind: ApplicationErrorKind;
  message: string;
  retryable: boolean;
  status?: number;
  errorCode?: string;
  reasonCode?: string;
  requestId?: string;
  fieldErrors: ApplicationFieldError[];
};

type ErrorLike = {
  status?: unknown;
  errorCode?: unknown;
  reasonCode?: unknown;
  requestId?: unknown;
  fieldErrors?: unknown;
};

const messagesByCode: Record<string, string> = {
  VALIDATION_FAILED: 'Revisa los campos indicados antes de continuar.',
  AUTHENTICATION_REQUIRED: 'Tu sesión no es válida. Inicia sesión nuevamente.',
  PERMISSION_DENIED: 'No tienes permiso para realizar esta operación.',
  RESOURCE_NOT_FOUND: 'La información solicitada no está disponible.',
  RESOURCE_STATE_CONFLICT: 'La información cambió mientras realizabas la operación. Actualiza los datos e intenta nuevamente.',
  IDEMPOTENCY_CONFLICT: 'Esta operación ya fue procesada con información diferente. Actualiza los datos antes de intentarlo nuevamente.',
  CLOSED_FINANCIAL_PERIOD: 'No puede registrar esta operación con la fecha seleccionada porque el período financiero ya tiene un cierre confirmado.',
  INTERNAL_ERROR: 'No se pudo completar la operación. Intenta nuevamente o contacta a soporte.',
};

const messagesByReason: Record<string, string> = {
  CLOSED_FINANCIAL_PERIOD: 'La fecha seleccionada pertenece a un período financiero cerrado. Elige otra fecha permitida para continuar.',
  FINANCIAL_OPENING_REQUIRED: 'La apertura financiera todavía no está configurada. Completa la apertura antes de continuar.',
  PAYMENT_DATE_INVALID: 'La fecha del pago está fuera del período operativo permitido. Revisa la fecha para continuar.',
  PAYMENT_DATE_BEFORE_LAST: 'La fecha no puede ser anterior al último pago válido registrado. Revisa la fecha para continuar.',
  PAYMENT_AMOUNT_EXCEEDS_BALANCE: 'El monto recibido supera el saldo pendiente. Ingresa un monto menor o igual al saldo.',
  PAYMENT_METHOD_REQUIRED: 'Selecciona una forma de pago para continuar.',
  PAYMENT_METHOD_INACTIVE: 'La forma de pago seleccionada está inactiva o ya no existe. Selecciona otra para continuar.',
  INVALID_COLLECTOR: 'El cobrador seleccionado no está disponible. Selecciona otro para continuar.',
  LOAN_NOT_ACTIVE: 'El préstamo ya no está activo y esta operación no puede continuar.',
  PAYMENT_NOT_LATEST: 'Sólo se puede anular el último pago válido. Actualiza la información antes de continuar.',
  PAYMENT_NOT_ANNULABLE: 'El pago ya no está vigente o ya fue reversado. Actualiza la información antes de continuar.',
  REFINANCED_LOAN_PAYMENT: 'Este pago pertenece a un préstamo refinanciado y no puede anularse por separado.',
  ANNULMENT_REASON_REQUIRED: 'Indica el motivo de la anulación para continuar.',
  ANNULMENT_TYPE_INVALID: 'Selecciona si corresponde a una corrección de datos o a una devolución de dinero.',
  CASH_MOVEMENT_DATE_INVALID: 'La fecha del movimiento no es válida para esta operación. Revisa la fecha para continuar.',
  CASH_MOVEMENT_AMOUNT_INVALID: 'El importe debe ser mayor que cero y tener hasta dos decimales.',
  REVERSAL_REASON_REQUIRED: 'Indica el motivo de la reversión para continuar.',
  LOAN_HAS_VALID_PAYMENTS: 'El préstamo tiene pagos válidos y no puede anularse. Revisa sus pagos antes de continuar.',
  REFINANCING_SUCCESSOR_LOAN: 'El préstamo proviene de un refinanciamiento y no puede anularse de forma aislada.',
  DISBURSEMENT_ALREADY_REVERSED: 'El desembolso ya fue reversado y la anulación no puede repetirse.',
  HISTORICAL_STATE_CONFLICT: 'Existen pagos posteriores a la fecha seleccionada. Revisa la fecha del refinanciamiento para continuar.',
  HISTORICAL_BALANCE_CONFLICT: 'El saldo histórico no coincide con el plan. Revisa la fecha y los importes antes de continuar.',
  FINANCIAL_INTEGRITY_ERROR: 'Los saldos no concilian y la operación fue bloqueada. Actualiza la información o contacta a soporte.',
  VALID_SUCCESSOR_PAYMENT: 'El préstamo sucesor tiene pagos válidos y el refinanciamiento no puede anularse.',
  ACTIVE_CHILD_REFINANCING: 'Existe un refinanciamiento posterior activo que bloquea esta anulación.',
  REFINANCING_NOT_CONFIRMED: 'El refinanciamiento no está confirmado y no puede anularse.',
  ORIGIN_NOT_REFINANCED: 'El préstamo origen ya no figura como refinanciado. Actualiza la información antes de continuar.',
  SUCCESSOR_NOT_ACTIVE: 'El préstamo sucesor ya no está activo. Actualiza la información antes de continuar.',
  CASH_REFUND_PAYMENT_INCOMPATIBLE: 'La devolución no es compatible con los pagos vigentes del préstamo sucesor.',
};

const messagesByStatus: Record<number, string> = {
  400: messagesByCode.VALIDATION_FAILED,
  401: messagesByCode.AUTHENTICATION_REQUIRED,
  403: messagesByCode.PERMISSION_DENIED,
  404: messagesByCode.RESOURCE_NOT_FOUND,
  409: messagesByCode.RESOURCE_STATE_CONFLICT,
  500: messagesByCode.INTERNAL_ERROR,
};

const kindByCode: Record<string, ApplicationErrorKind> = {
  VALIDATION_FAILED: 'validation', AUTHENTICATION_REQUIRED: 'authentication', PERMISSION_DENIED: 'permission',
  RESOURCE_NOT_FOUND: 'not-found', RESOURCE_STATE_CONFLICT: 'conflict', IDEMPOTENCY_CONFLICT: 'conflict',
  CLOSED_FINANCIAL_PERIOD: 'closed-period', INTERNAL_ERROR: 'unexpected',
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string' ? value : undefined;

export function safeApiErrorMessage(status?: number, errorCode?: string, reasonCode?: string): string {
  return reasonCode && messagesByReason[reasonCode] ? messagesByReason[reasonCode] :
    errorCode && messagesByCode[errorCode] ? messagesByCode[errorCode] :
    status && messagesByStatus[status] ? messagesByStatus[status] : messagesByCode.INTERNAL_ERROR;
}

export function readApplicationFieldErrors(value: unknown): ApplicationFieldError[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ApplicationFieldError[] => {
    if (!isRecord(item) || typeof item.field !== 'string' || typeof item.message !== 'string' ||
      !Array.isArray(item.codes) || !item.codes.every((code) => typeof code === 'string')) return [];
    return [{ field: item.field, codes: item.codes, message: item.message }];
  });
}

export function applicationFieldError(errors: ApplicationFieldError[], field: string): string | undefined {
  return errors.find((error) => error.field === field)?.message;
}

export class ApiConnectionError extends Error {
  constructor() { super('No se pudo conectar con el servidor. Revisa tu conexión e intenta nuevamente.'); this.name = 'ApiConnectionError'; }
}

export function interpretApplicationError(error: unknown, fallback = messagesByCode.INTERNAL_ERROR): InterpretedApplicationError {
  if (error instanceof ApiConnectionError) return { kind: 'network', message: error.message, retryable: true, fieldErrors: [] };
  const value = isRecord(error) ? error as ErrorLike : {};
  const status = typeof value.status === 'number' ? value.status : undefined;
  const errorCode = text(value.errorCode);
  const reasonCode = text(value.reasonCode);
  const requestId = text(value.requestId);
  const fieldErrors = readApplicationFieldErrors(value.fieldErrors);
  if (status !== undefined || errorCode) {
    const kind = errorCode && kindByCode[errorCode] ? kindByCode[errorCode] : status === 400 ? 'validation' :
      status === 401 ? 'authentication' : status === 403 ? 'permission' : status === 404 ? 'not-found' :
        status === 409 ? 'conflict' : 'unexpected';
    return { kind, message: safeApiErrorMessage(status, errorCode, reasonCode), retryable: kind === 'unexpected',
      status, errorCode, reasonCode, requestId, fieldErrors };
  }
  return { kind: 'unexpected', message: fallback, retryable: true, fieldErrors: [] };
}
