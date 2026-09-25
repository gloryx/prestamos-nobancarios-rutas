import type { ReactElement, ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/auth-context';
export function RouteGuard({ permission, children }: { permission?: string; children: ReactNode }): ReactElement {
  const { user, loading, can } = useAuth(); const location = useLocation();
  if (loading) return <div className="auth-loading" role="status">Cargando sesión…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (permission && !can(permission)) return <div className="catalog-message catalog-message--error" role="alert">No tienes permiso para acceder a esta sección.</div>;
  return <>{children}</>;
}
