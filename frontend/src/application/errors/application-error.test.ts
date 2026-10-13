import { describe, expect, it } from 'vitest';
import { ApiConnectionError, interpretApplicationError, safeApiErrorMessage } from './application-error';

describe('central application error interpreter', () => {
  it.each([
    [400, 'VALIDATION_FAILED', 'validation'], [401, 'AUTHENTICATION_REQUIRED', 'authentication'],
    [403, 'PERMISSION_DENIED', 'permission'], [404, 'RESOURCE_NOT_FOUND', 'not-found'],
    [409, 'RESOURCE_STATE_CONFLICT', 'conflict'], [500, 'INTERNAL_ERROR', 'unexpected'],
  ] as const)('classifies HTTP %i without exposing backend text', (status, errorCode, kind) => {
    const result = interpretApplicationError({ status, errorCode, message: 'private SQL constraint' });
    expect(result).toMatchObject({ status, errorCode, kind });
    expect(result.message).toBe(safeApiErrorMessage(status, errorCode));
    expect(result.message).not.toMatch(/SQL|constraint/i);
  });

  it('preserves stable diagnostics and structured field errors', () => {
    expect(interpretApplicationError({ status: 409, errorCode: 'CLOSED_FINANCIAL_PERIOD', reasonCode: 'PERIOD_CLOSED',
      requestId: 'request-1', fieldErrors: [{ field: 'paymentDate', codes: ['INVALID_DATE'], message: 'Ingresa una fecha válida.' }] }))
      .toMatchObject({ kind: 'closed-period', reasonCode: 'PERIOD_CLOSED', requestId: 'request-1',
        fieldErrors: [{ field: 'paymentDate', codes: ['INVALID_DATE'] }] });
  });

  it('prioritizes actionable financial reason codes over generic status copy', () => {
    expect(safeApiErrorMessage(409, 'RESOURCE_STATE_CONFLICT', 'CLOSED_FINANCIAL_PERIOD'))
      .toBe('La fecha seleccionada pertenece a un período financiero cerrado. Elige otra fecha permitida para continuar.');
    expect(safeApiErrorMessage(400, 'VALIDATION_FAILED', 'PAYMENT_METHOD_INACTIVE')).toContain('Selecciona otra');
  });

  it('uses safe local copy for connection and unknown errors', () => {
    expect(interpretApplicationError(new ApiConnectionError())).toMatchObject({ kind: 'network', retryable: true,
      message: 'No se pudo conectar con el servidor. Revisa tu conexión e intenta nuevamente.' });
    const unknown = interpretApplicationError(new Error('private stack'), 'No se pudo guardar la información.');
    expect(unknown.message).toBe('No se pudo guardar la información.');
    expect(JSON.stringify(unknown)).not.toContain('private stack');
  });
});
