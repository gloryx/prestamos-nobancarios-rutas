import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiConnectionError } from '../../application/errors/application-error';
import { apiClient, HttpApiError, UnauthorizedApiError } from './api-client';

afterEach(() => vi.restoreAllMocks());

const failedResponse = (status: number, body: unknown) => ({ ok: false, status, json: async () => body }) as Response;

describe('safe API client errors', () => {
  it.each([
    [400, 'VALIDATION_FAILED'], [403, 'PERMISSION_DENIED'], [404, 'RESOURCE_NOT_FOUND'],
    [409, 'RESOURCE_STATE_CONFLICT'], [500, 'INTERNAL_ERROR'],
  ])('keeps HTTP %i metadata while hiding unknown backend messages', async (status, errorCode) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(failedResponse(status, {
      message: 'private SQL constraint users_email_key', errorCode, requestId: 'request-1',
    }));
    const error = await apiClient.request('/test').catch((cause) => cause) as HttpApiError;
    expect(error).toMatchObject({ status, errorCode, requestId: 'request-1' });
    expect(error.message).not.toMatch(/SQL|constraint|users_email_key/i);
  });

  it('preserves reasonCode and validated field metadata', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(failedResponse(409, { message: 'private',
      errorCode: 'RESOURCE_STATE_CONFLICT', reasonCode: 'STALE_DATA', requestId: 'request-2',
      data: { fields: [{ field: 'amount', codes: ['INVALID_NUMBER'], message: 'Ingresa un número válido.' },
        { field: 1, codes: [], message: 'invalid' }] } }));
    await expect(apiClient.request('/test')).rejects.toMatchObject({ status: 409, reasonCode: 'STALE_DATA',
      errorCode: 'RESOURCE_STATE_CONFLICT', requestId: 'request-2',
      fieldErrors: [{ field: 'amount', codes: ['INVALID_NUMBER'], message: 'Ingresa un número válido.' }] });
  });

  it('preserves the centralized unauthorized flow', async () => {
    const unauthorized = vi.fn();
    const remove = apiClient.onUnauthorized(unauthorized);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(failedResponse(401, {}));
    try {
      await expect(apiClient.request('/test')).rejects.toBeInstanceOf(UnauthorizedApiError);
      expect(unauthorized).toHaveBeenCalledTimes(1);
    } finally { remove(); }
  });

  it('uses the same safe HTTP contract for downloads', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(failedResponse(401, { requestId: 'download-request' }));
    await expect(apiClient.blob('/file')).rejects.toMatchObject({
      status: 401, errorCode: 'AUTHENTICATION_REQUIRED', requestId: 'download-request',
    });
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(failedResponse(500, {
      message: 'private SQL detail', errorCode: 'INTERNAL_ERROR', requestId: 'download-failure',
    }));
    await expect(apiClient.blob('/file')).rejects.toMatchObject({
      status: 500, errorCode: 'INTERNAL_ERROR', requestId: 'download-failure',
      message: 'No se pudo completar la operación. Intenta nuevamente o contacta a soporte.',
    });
  });

  it('normalizes request and download connection failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch private URL'));
    await expect(apiClient.request('/test')).rejects.toBeInstanceOf(ApiConnectionError);
    await expect(apiClient.blob('/file')).rejects.toMatchObject({
      message: 'No se pudo conectar con el servidor. Revisa tu conexión e intenta nuevamente.',
    });
  });
});
