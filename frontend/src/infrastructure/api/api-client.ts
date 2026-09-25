const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:3000';

export class UnauthorizedApiError extends Error { constructor() { super('Sesión no válida.'); this.name = 'UnauthorizedApiError'; } }
let unauthorizedHandler: (() => void) | undefined;
export const apiClient = {
  onUnauthorized(handler: () => void): () => void { unauthorizedHandler = handler; return () => { if (unauthorizedHandler === handler) unauthorizedHandler = undefined; }; },
  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers, credentials: 'include' });
    if (response.status === 401) { unauthorizedHandler?.(); throw new UnauthorizedApiError(); }
    if (!response.ok) {
      const payload = await response.json().catch(() => undefined) as { message?: string | string[] } | undefined;
      const message = Array.isArray(payload?.message) ? payload.message.join(' ') : payload?.message;
      throw new Error(message ?? 'No fue posible completar la solicitud.');
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  },
  async blob(path: string): Promise<Blob> {
    const response = await fetch(`${API_BASE_URL}${path}`, { credentials: 'include' });
    if (response.status === 401) { unauthorizedHandler?.(); throw new UnauthorizedApiError(); }
    if (!response.ok) throw new Error('Archivo no disponible.');
    return response.blob();
  },
};
