import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { AuthIdentity } from '../../domain/entities/auth';
import { RouteGuard } from '../components/auth/RouteGuard';
import { AppLayout } from '../components/layout/AppLayout';
import { canAccess } from '../hooks/auth-permissions';
import { AuthContext } from '../hooks/auth-context';
import { PaymentsPage } from '../pages/PaymentsPage';
import { CancelledLoansPage } from '../pages/CancelledLoansPage';
import { LoanManagementPage } from '../pages/LoanManagementPage';
import { LoanAnnulmentManagementPage } from '../pages/LoanAnnulmentManagementPage';
import { AppRouter } from './AppRouter';

const elements = (node: ReactNode): ReactElement[] => Children.toArray(node).flatMap((child) =>
  isValidElement(child) ? [child, ...elements((child.props as { children?: ReactNode }).children)] : []);
const identity: AuthIdentity = { id: 'user', username: 'tester', fullName: 'Tester', role: { id: 'role', code: 'ROLE', name: 'Role', isSuperAdmin: false }, permissions: [] };

function renderRoute(path: string, user: AuthIdentity | undefined): string {
  const layoutRoute = elements(AppRouter()).find((element) => element.type === Route &&
    (element.props as { path?: string }).path === undefined);
  if (!layoutRoute) throw new Error('Protected layout route is missing.');
  return renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><AuthContext.Provider value={{ user, loading: false,
    can: (code) => canAccess(user, code), canAll: (codes) => codes.every((code) => canAccess(user, code)),
    login: async () => {}, logout: async () => {}, changePassword: async () => {} }}>
    <Routes>{layoutRoute}</Routes>
  </AuthContext.Provider></MemoryRouter>);
}

describe('payment browser routes', () => {
  it('redirects the legacy route under authentication and guards the registration page', () => {
    const layoutRoute = elements(AppRouter()).find((element) => element.type === Route &&
      (element.props as { path?: string }).path === undefined);
    expect((layoutRoute?.props as { element?: ReactNode }).element).toMatchObject({
      type: RouteGuard,
      props: { children: { type: AppLayout } },
    });

    const paymentRoutes = elements((layoutRoute?.props as { children?: ReactNode }).children)
      .filter((element) => element.type === Route &&
        ['/payments', '/payments/new'].includes((element.props as { path?: string }).path ?? ''));
    expect(paymentRoutes).toHaveLength(2);

    const legacyRoute = paymentRoutes.find((route) => (route.props as { path?: string }).path === '/payments');
    const legacyElement = (legacyRoute?.props as { element?: ReactNode }).element;
    expect(legacyElement).toMatchObject({ type: Navigate, props: { to: '/payments/new', replace: true } });
    expect(elements(legacyElement).some((element) => element.type === PaymentsPage)).toBe(false);

    const registrationRoute = paymentRoutes.find((route) => (route.props as { path?: string }).path === '/payments/new');
    expect((registrationRoute?.props as { element?: ReactNode }).element).toMatchObject({
      type: RouteGuard,
      props: { permission: 'payments.view', children: { type: PaymentsPage } },
    });
  });
});

describe('cancelled loan browser route', () => {
  it('registers the read-only route before loan detail, with loans.view', () => {
    const routes = elements(AppRouter()).filter((element) => element.type === Route);
    const cancelledIndex = routes.findIndex((route) => (route.props as { path?: string }).path === '/loans/cancelled');
    const detailIndex = routes.findIndex((route) => (route.props as { path?: string }).path === '/loans/:id');
    expect(cancelledIndex).toBeGreaterThanOrEqual(0);
    expect(cancelledIndex).toBeLessThan(detailIndex);
    expect((routes[cancelledIndex].props as { element: ReactNode }).element).toMatchObject({ type: RouteGuard, props: { permission: 'loans.view', children: { type: CancelledLoansPage } } });
  });
});

describe('uncollectible loan publication', () => {
  const path = '/loans/uncollectible-management';

  it('registers one static loans.view route before loan detail without replacing existing routes', () => {
    const routes = elements(AppRouter()).filter((element) => element.type === Route);
    const loanPaths = routes.map((route) => (route.props as { path?: string }).path)
      .filter((route) => route?.startsWith('/loans'));
    expect(loanPaths).toEqual(['/loans/new', '/loans/cancelled', path, '/loans/annulments', '/loans/:id', '/loans']);
    expect(routes.map((route) => (route.props as { path?: string }).path)).toEqual(expect.arrayContaining(['/payments', '/payments/new', '/customers']));
    const managementRoute = routes.find((route) => (route.props as { path?: string }).path === path);
    expect((managementRoute?.props as { element?: ReactNode }).element).toMatchObject({
      type: RouteGuard, props: { permission: 'loans.view', children: { type: LoanManagementPage } },
    });
  });

  it('renders the existing overdue-first page at its direct URL for a view-only user', () => {
    const html = renderRoute(path, { ...identity, permissions: ['loans.view'] });
    expect(html).toContain('Gestión de incobrables');
    expect(html).toContain('role="tab" id="loan-management-overdue-tab"');
    expect(html).toContain('role="tab" id="loan-management-uncollectible-tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('Cargando préstamos');
    expect(html).not.toContain('No tienes permiso');
  });

  it('denies a status-only user and does not render protected content when unauthenticated', () => {
    const denied = renderRoute(path, { ...identity, permissions: ['loans.status.uncollectible', 'loans.status.reactivate'] });
    expect(denied).toContain('role="alert">No tienes permiso para acceder a esta sección.');
    expect(denied).not.toContain('Gestión de incobrables');
    expect(denied).not.toContain(`href="${path}"`);
    expect(renderRoute(path, undefined)).not.toContain('Gestión de incobrables');
  });

  it('uses centralized superadmin access without explicit view or status permissions', () => {
    const superAdmin = { ...identity, role: { ...identity.role, isSuperAdmin: true } };
    expect(canAccess(superAdmin, 'loans.status.uncollectible')).toBe(true);
    expect(canAccess(superAdmin, 'loans.status.reactivate')).toBe(true);
    const html = renderRoute(path, superAdmin);
    expect(html).toContain('Gestión de incobrables');
    expect(html).toContain(`href="${path}"`);
  });
});

describe('loan annulment publication', () => {
  const path = '/loans/annulments';
  it('guards the direct URL by loans.view and renders its candidate tab', () => {
    const routes = elements(AppRouter()).filter((element) => element.type === Route);
    const entry = routes.find((route) => (route.props as { path?: string }).path === path);
    expect((entry?.props as { element?: ReactNode }).element).toMatchObject({
      type: RouteGuard, props: { permission: 'loans.view', children: { type: LoanAnnulmentManagementPage } },
    });
    const allowed = renderRoute(path, { ...identity, permissions: ['loans.view'] });
    expect(allowed).toContain('Gestión de anulaciones');
    expect(allowed).toContain('role="tab" id="loan-annulment-candidates-tab"');
    expect(allowed).toContain(`href="${path}"`);
    expect(allowed).toContain('nav-link--active" href="/loans/annulments"');
    expect(renderRoute(path, { ...identity, permissions: ['loans.status.annul'] })).toContain('No tienes permiso');
    expect(renderRoute(path, undefined)).not.toContain('Gestión de anulaciones');
  });
});
