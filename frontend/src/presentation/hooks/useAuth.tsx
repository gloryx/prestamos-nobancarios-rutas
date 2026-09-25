import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { AuthIdentity } from '../../domain/entities/auth';
import { securityApi, security } from '../../app/security';
import { apiClient, UnauthorizedApiError } from '../../infrastructure/api/api-client';
import { AuthContext, type AuthContextValue } from './auth-context';
import { canAccess, canAccessAll } from './auth-permissions';
export function AuthProvider({ children }: { children: ReactNode }): ReactElement {
  const navigate = useNavigate(); const location = useLocation(); const [user, setUser] = useState<AuthIdentity>(); const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; void security.me.execute().then((identity) => { if (active) setUser(identity); }).catch((error) => { if (error instanceof UnauthorizedApiError && location.pathname !== '/login') navigate('/login', { replace: true }); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  useEffect(() => apiClient.onUnauthorized(() => { setUser(undefined); if (location.pathname !== '/login') navigate('/login', { replace: true }); }), [location.pathname, navigate]);
  const value = useMemo<AuthContextValue>(() => ({ user, loading, login: async (input) => { const identity = await security.login.execute(input); setUser(identity); navigate('/dashboard', { replace: true }); }, logout: async () => { try { await security.logout.execute(); } finally { setUser(undefined); navigate('/login', { replace: true }); } }, changePassword: (current, next) => securityApi.changePassword(current, next), can: (code) => canAccess(user, code), canAll: (codes) => canAccessAll(user, codes) }), [user, loading, navigate]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
