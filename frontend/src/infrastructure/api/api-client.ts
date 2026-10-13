import { ApiConnectionError, readApplicationFieldErrors, safeApiErrorMessage,
  type ApplicationFieldError } from '../../application/errors/application-error';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:3000';

export class UnauthorizedApiError extends Error {
  readonly status = 401;
  readonly errorCode = 'AUTHENTICATION_REQUIRED';
  constructor(readonly requestId?: string) { super('Tu sesión no es válida. Inicia sesión nuevamente.'); this.name = 'UnauthorizedApiError'; }
}
export class HttpApiError extends Error {
  constructor(readonly status: number, _backendMessage: string, readonly reasonCode?: string,
    readonly errorCode?: string, readonly fieldErrors: ApplicationFieldError[] = [], readonly requestId?: string) {
    super(safeApiErrorMessage(status, errorCode, reasonCode)); this.name = 'HttpApiError';
  }
}
let unauthorizedHandler: (() => void) | undefined;
type ApiErrorPayload = { message?: string | string[]; errorCode?: unknown; reasonCode?: unknown;
  requestId?: unknown; data?: { fields?: unknown } };
const request = async (path: string, options: RequestInit): Promise<Response> => {
  try { return await fetch(`${API_BASE_URL}${path}`, { ...options, credentials: 'include' }); }
  catch { throw new ApiConnectionError(); }
};
const throwResponseError = async (response: Response): Promise<never> => {
  const payload = await response.json().catch(() => undefined) as ApiErrorPayload | undefined;
  if (response.status === 401) {
    unauthorizedHandler?.();
    throw new UnauthorizedApiError(typeof payload?.requestId === 'string' ? payload.requestId : undefined);
  }
  const message = Array.isArray(payload?.message) ? payload.message.join(' ') : payload?.message;
  throw new HttpApiError(response.status, message ?? 'No fue posible completar la solicitud.',
    typeof payload?.reasonCode === 'string' ? payload.reasonCode : undefined,
    typeof payload?.errorCode === 'string' ? payload.errorCode : undefined,
    readApplicationFieldErrors(payload?.data?.fields),
    typeof payload?.requestId === 'string' ? payload.requestId : undefined);
};
export const apiClient = {
  onUnauthorized(handler: () => void): () => void { unauthorizedHandler = handler; return () => { if (unauthorizedHandler === handler) unauthorizedHandler = undefined; }; },
  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await request(path, { ...options, headers });
    if (!response.ok) await throwResponseError(response);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  },
  async blob(path: string): Promise<Blob> {
    const response = await request(path, {});
    if (!response.ok) await throwResponseError(response);
    return response.blob();
  },
};
