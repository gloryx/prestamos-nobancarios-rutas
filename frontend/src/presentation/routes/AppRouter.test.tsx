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
import { DailyCollectionsPage } from '../pages/DailyCollectionsPage';
import { PaymentHistoryPage } from '../pages/PaymentHistoryPage';
import { CancelledLoansPage } from '../pages/CancelledLoansPage';
import { LoanManagementPage } from '../pages/LoanManagementPage';
import { LoanAnnulmentManagementPage } from '../pages/LoanAnnulmentManagementPage';
import { NewRefinancingPage } from '../pages/NewRefinancingPage';
import { RefinancingsPage } from '../pages/RefinancingsPage';
import { RefinancingDetailPage } from '../pages/RefinancingDetailPage';
import { RefinancingChainsPage } from '../pages/RefinancingChainsPage';
import { ProfitabilityPage } from '../pages/ProfitabilityPage';
import { FinancialAnalysisPage } from '../pages/FinancialAnalysisPage';
import { CustomerStatisticsPage } from '../pages/CustomerStatisticsPage';
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

describe('daily collections publication', () => {
  it('renders the direct URL and active sidebar only for payments.view', () => {
    const path = '/payments/daily-collections';
    const routes = elements(AppRouter()).filter((element) => element.type === Route);
    const entry = routes.find((route) => (route.props as { path?: string }).path === path);
    expect((entry?.props as { element?: ReactNode }).element).toMatchObject({
      type: RouteGuard, props: { permission: 'payments.view', children: { type: DailyCollectionsPage } },
    });
    const allowed = renderRoute(path, { ...identity, permissions: ['payments.view'] });
    expect(allowed).toContain('Cobros del día');
    expect(allowed).toContain('nav-link--active" href="/payments/daily-collections"');
    expect(renderRoute(path, { ...identity, permissions: [] })).toContain('No tienes permiso');
  });
});

describe('payment history publication', () => {
  it('guards the direct URL and active payments navigation by payments.view', () => {
    const path = '/payments/history';
    const routes = elements(AppRouter()).filter((element) => element.type === Route);
    const entry = routes.find((route) => (route.props as { path?: string }).path === path);
    expect((entry?.props as { element?: ReactNode }).element).toMatchObject({ type: RouteGuard,
      props: { permission: 'payments.view', children: { type: PaymentHistoryPage } } });
    const allowed = renderRoute(path, { ...identity, permissions: ['payments.view'] });
    expect(allowed).toContain('Historial de pagos');
    expect(allowed).toContain('nav-link--active" href="/payments/history"');
    expect(renderRoute(path, { ...identity, permissions: [] })).toContain('No tienes permiso');
    expect(renderRoute(path, { ...identity, role: { ...identity.role, isSuperAdmin: true } })).toContain('Historial de pagos');
  });
});

describe('integral profitability publication', () => {
  const path = '/finance/reports/profitability';
  it('guards the direct report and nested navigation with cash-movements.view', () => {
    const routes = elements(AppRouter()).filter((element) => element.type === Route);
    const entry = routes.find((route) => (route.props as { path?: string }).path === path);
    expect((entry?.props as { element?: ReactNode }).element).toMatchObject({ type: RouteGuard,
      props: { permission: 'cash-movements.view', children: { type: ProfitabilityPage } } });
    const allowed = renderRoute(path, { ...identity, permissions: ['cash-movements.view'] });
    expect(allowed).toContain('Rentabilidad integral');
    expect(allowed).toContain('nav-group--nested nav-group--active');
    expect(allowed).toContain(`href="${path}"`);
    expect(renderRoute(path, { ...identity, permissions: [] })).toContain('No tienes permiso');
    expect(renderRoute(path, { ...identity, role: { ...identity.role, isSuperAdmin: true } })).toContain('Rentabilidad integral');
  });
});

describe('customer financial analysis publication', () => {
  const path = '/customers/:customerId/financial-analysis';
  it('registers static selection and customer-scoped routes with the dedicated permission', () => {
    const routes = elements(AppRouter()).filter((element) => element.type === Route);
    for (const expected of ['/customers/financial-analysis', path]) {
      const entry = routes.find((route) => (route.props as { path?: string }).path === expected);
      expect((entry?.props as { element?: ReactNode }).element).toMatchObject({ type: RouteGuard,
        props: { permission: 'customers.analysis.view', children: { type: FinancialAnalysisPage } } });
    }
    const allowed = renderRoute('/customers/customer-1/financial-analysis', { ...identity, permissions: ['customers.analysis.view'] });
    expect(allowed).toContain('Análisis financiero del cliente');
    expect(renderRoute('/customers/customer-1/financial-analysis', { ...identity, permissions: ['customers.view'] })).toContain('No tienes permiso');
    expect(renderRoute('/customers/customer-1/financial-analysis', { ...identity, role: { ...identity.role, isSuperAdmin: true } })).toContain('Análisis financiero del cliente');
  });
});

describe('customer statistics publication', () => {
  const path = '/customers/statistics';
  it('guards the independent customer route with customers.summary.view only', () => {
    const routes = elements(AppRouter()).filter((element) => element.type === Route);
    const entry = routes.find((route) => (route.props as { path?: string }).path === path);
    expect((entry?.props as { element?: ReactNode }).element).toMatchObject({ type: RouteGuard,
      props: { permission: 'customers.summary.view', children: { type: CustomerStatisticsPage } } });
    expect(renderRoute(path, { ...identity, permissions: ['customers.summary.view'] })).toContain('Estadísticas de clientes');
    expect(renderRoute(path, { ...identity, permissions: ['customers.analysis.view'] })).toContain('No tienes permiso');
    expect(renderRoute(path, { ...identity, role: { ...identity.role, isSuperAdmin: true } })).toContain('Estadísticas de clientes');
  });

  it('does not publish the customer statistics screen inside the main dashboard', () => {
    const dashboard = renderRoute('/dashboard', { ...identity, permissions: ['customers.summary.view'] });
    expect(dashboard).not.toContain('class="page-section customer-statistics"');
  });
});

describe('refinancing origin route', () => {
  const path = '/loan-refinancings/new';

  it('publishes Step 1 with centralized view permission and the active nested sidebar group', () => {
    const routes = elements(AppRouter()).filter((element) => element.type === Route);
    const entry = routes.find((route) => (route.props as { path?: string }).path === path);
    expect((entry?.props as { element?: ReactNode }).element).toMatchObject({ type: RouteGuard,
      props: { permission: 'loans.refinance.view', children: { type: NewRefinancingPage } } });
    const allowed = renderRoute(path, { ...identity, permissions: ['loans.refinance.view'] });
    expect(allowed).toContain('Nuevo refinanciamiento');
    expect(allowed).toContain('nav-group--nested nav-group--active');
    expect(allowed).toContain(`href="${path}"`);
    expect(allowed).not.toContain('No tienes permiso');
    expect(renderRoute(path, { ...identity, permissions: ['loans.view'] })).toContain('No tienes permiso');
    expect(renderRoute(path, undefined)).not.toContain('Nuevo refinanciamiento');
    expect(renderRoute(path, { ...identity, role: { ...identity.role, isSuperAdmin: true } })).toContain('Nuevo refinanciamiento');
  });

  it('registers a read-only persisted detail route behind the same view permission', () => {
    const routes = elements(AppRouter()).filter((element) => element.type === Route);
    const entry = routes.find((route) => (route.props as { path?: string }).path === '/loan-refinancings/:id');
    expect((entry?.props as { element?: ReactNode }).element).toMatchObject({ type: RouteGuard,
      props: { permission: 'loans.refinance.view', children: { type: RefinancingDetailPage } } });
    expect(renderRoute('/loan-refinancings/ref-1', { ...identity, permissions: ['loans.refinance.view'] })).toContain('Cargando refinanciamiento');
    expect(renderRoute('/loan-refinancings/ref-1', { ...identity, permissions: [] })).toContain('No tienes permiso');
  });

  it('registers the separate operation list route without losing creation and detail routes', () => {
    const path = '/loan-refinancings';
    const routes = elements(AppRouter()).filter((element) => element.type === Route);
    const listRoute = routes.find((route) => (route.props as { path?: string }).path === path);
    expect((listRoute?.props as { element?: ReactNode }).element).toMatchObject({ type: RouteGuard,
      props: { permission: 'loans.refinance.view', children: { type: RefinancingsPage } } });
    expect(routes.map((route) => (route.props as { path?: string }).path))
      .toEqual(expect.arrayContaining([path, `${path}/new`, `${path}/chains`, `${path}/chains/loan/:loanId`, `${path}/:id`]));
    const viewOnly = renderRoute(path, { ...identity, permissions: ['loans.refinance.view'] });
    expect(viewOnly).toContain('Consulta y analiza las operaciones de refinanciamiento registradas.');
    expect(viewOnly).toContain('nav-group--nested nav-group--active');
    expect(viewOnly).toContain('Se requiere permiso para consultar clientes.');
    expect(renderRoute(path, { ...identity, permissions: [] })).toContain('No tienes permiso');
    expect(renderRoute(path, { ...identity, role: { ...identity.role, isSuperAdmin: true } })).not.toContain('Se requiere permiso para consultar clientes.');
  });

  it('publishes customer and direct-loan chain routes before generic detail with the shared view permission', () => {
    const routes = elements(AppRouter()).filter((element) => element.type === Route);
    const paths = routes.map((route) => (route.props as { path?: string }).path);
    for (const path of ['/loan-refinancings/chains', '/loan-refinancings/chains/loan/:loanId']) {
      const entry = routes.find((route) => (route.props as { path?: string }).path === path);
      expect((entry?.props as { element?: ReactNode }).element).toMatchObject({ type: RouteGuard,
        props: { permission: 'loans.refinance.view', children: { type: RefinancingChainsPage } } });
      expect(paths.indexOf(path)).toBeLessThan(paths.indexOf('/loan-refinancings/:id'));
    }
    const allowed = renderRoute('/loan-refinancings/chains', { ...identity, permissions: ['loans.refinance.view'] });
    expect(allowed).toContain('Cadenas de refinanciamiento');
    expect(allowed).toContain('El selector de clientes no está disponible con tus permisos.');
    expect(renderRoute('/loan-refinancings/chains', { ...identity, permissions: [] })).toContain('No tienes permiso');
    expect(renderRoute('/loan-refinancings/chains/loan/root', { ...identity,
      permissions: ['loans.refinance.view'] })).toContain('Cargando cadenas de refinanciamiento');
  });
});
