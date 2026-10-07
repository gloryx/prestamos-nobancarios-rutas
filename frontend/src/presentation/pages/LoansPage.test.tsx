import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ActiveLoanListItem } from '../../domain/entities/loan';
import type { AuthIdentity } from '../../domain/entities/auth';
import { AuthContext, type AuthContextValue } from '../hooks/auth-context';
import { canAccess } from '../hooks/auth-permissions';
import { TableActions, type TableAction } from '../components/TableActions';
import { ActiveLoanSummaryView, ActiveLoansTable, LoansPage, LoansPageRoute } from './LoansPage';

const loan: ActiveLoanListItem = { id: '14870d77-8723-49e5-96b8-e4313943d726', loanNumber: '42', startDate: '2026-01-01', principal: '100.00', interestAmount: '10.00', totalAmount: '110.00', customerName: 'Ana', identification: '101', frequencyName: 'Mensual', pendingTotal: '60.00', isOverdue: false };
const onSort = vi.fn(), onView = vi.fn(), onEdit = vi.fn(), onDownload = vi.fn();
const props: Parameters<typeof ActiveLoansTable>[0] = { items: [loan, { ...loan, id: 'loan-2', loanNumber: '43', isOverdue: true }], sortBy: 'number', sortOrder: 'desc', onSort, onView, onEdit, onDownload, canEdit: false, canExport: true, canRegisterPayment: false };
const markup = (override: Partial<typeof props> = {}) => renderToStaticMarkup(<MemoryRouter><ActiveLoansTable {...props} {...override} /></MemoryRouter>);
const elements = (node: ReactNode): ReactElement[] => Array.isArray(node) ? node.flatMap(elements) : isValidElement(node) ? [node, ...elements((node.props as { children?: ReactNode }).children)] : [];
const user: AuthIdentity = { id: 'user', username: 'u', fullName: 'User', role: { id: 'role', code: 'ROLE', name: 'Role', isSuperAdmin: false }, permissions: ['loans.view'] };

describe('active loan condition presentation', () => {
  it('renders the five compact all-portfolio indicators with reconciled financial values', () => {
    const summary = { totalActiveLoans: 209, capitalPlaced: '31000000.00', outstandingPrincipal: '18500000.00',
      outstandingInterest: '3200000.00', financialBalance: '21700000.00' };
    const html = renderToStaticMarkup(<ActiveLoanSummaryView summary={summary} loading={false} />);
    expect(html).toContain('aria-label="Resumen financiero de préstamos activos"');
    expect([...html.matchAll(/<span>(.*?)<\/span>/g)].map((match) => match[1])).toEqual([
      'Préstamos activos', 'Capital colocado', 'Capital pendiente', 'Interés pendiente', 'Saldo pendiente']);
    expect(html).toContain('<strong>209</strong>');
    for (const value of ['₡31.000.000', '₡18.500.000', '₡3.200.000', '₡21.700.000']) expect(html).toContain(value);
    expect(Number(summary.financialBalance)).toBe(Number(summary.outstandingPrincipal) + Number(summary.outstandingInterest));
  });

  it('keeps all existing columns, currency, and compact actions while adding selector-colored badges between Pend. and Acciones', () => {
    const html = markup();
    expect([...html.matchAll(/<th\b[^>]*>(.*?)<\/th>/g)].map((match) => match[1].replace(/<[^>]*>/g, ''))).toEqual(['N°', 'Cliente', 'Inicio', 'Cap.', 'Int.', 'Total', 'Frec.', 'Pend.', 'Condición', 'Acciones']);
    expect(html).toContain('>₡60</td><td class="loan-list__center"><span class="status-badge status-badge--active">AL DÍA</span>');
    expect(html).toContain('class="status-badge payment-loan-dialog__late">CON ATRASO</span>');
    expect(html).toContain('loan-list__table-wrap');
    expect(html).toContain('aria-label="Ver información del préstamo 42"');
    expect(html).toContain('aria-label="Descargar plan de pago del préstamo 42"');
    expect(html).not.toContain('status-badge--inactive');
  });

  it('wires the condition header to server sort callbacks and preserves View and permission-gated PDF', () => {
    const tree = elements(ActiveLoansTable(props));
    const header = tree.find((element) => (element.props as { column?: string }).column === 'condition')!;
    const resolved = (header.type as (props: typeof header.props) => ReactElement)(header.props);
    const button = elements(resolved).find((element) => element.type === 'button')!;
    expect((button.props as { 'aria-label': string })['aria-label']).toBe('Condición: ordenar ascendente');
    (button.props as { onClick: () => void }).onClick();
    expect(onSort).toHaveBeenCalledWith('condition');
    expect(markup({ sortBy: 'condition', sortOrder: 'asc' })).toContain('aria-sort="ascending"');
    expect(markup({ sortBy: 'condition', sortOrder: 'desc' })).toContain('aria-label="Condición: ordenar ascendente"');
    expect(markup({ sortBy: 'condition', sortOrder: 'asc' })).toContain('aria-label="Condición: ordenar descendente"');

    const actions = tree.find((element) => element.type === TableActions)!;
    const allowed = (actions.props as { actions: TableAction[] }).actions;
    expect(allowed.map((action) => action.key)).toEqual(['view', 'download']);
    allowed[0].onClick?.(); allowed[1].onClick?.();
    expect(onView).toHaveBeenCalledWith(loan);
    expect(onDownload).toHaveBeenCalledWith(loan);
    expect(markup({ canExport: false })).not.toContain('Descargar plan de pago');
    expect(markup({ canExport: false })).toContain('Ver información del préstamo 42');
  });

  it('links an active loan to its payment context only with both centralized permissions, including superadmin', () => {
    for (const [permissions, visible] of [
      [['payments.view', 'payments.create'], true], [['payments.view'], false], [['payments.create'], false], [[], false],
    ] as const) {
      const identity = { ...user, permissions: [...permissions] };
      const canRegisterPayment = canAccess(identity, 'payments.view') && canAccess(identity, 'payments.create');
      const html = markup({ canRegisterPayment, items: [loan] });
      expect(html.includes('aria-label="Registrar pago"')).toBe(visible);
      expect(html).toContain('aria-label="Ver información del préstamo 42"');
      expect(html).toContain('aria-label="Descargar plan de pago del préstamo 42"');
      if (visible) {
        expect(html).toContain(`href="/payments/new?loanId=${loan.id}"`);
        expect(html.indexOf('aria-label="Ver información')).toBeLessThan(html.indexOf('aria-label="Registrar pago"'));
        expect(html.indexOf('aria-label="Registrar pago"')).toBeLessThan(html.indexOf('aria-label="Descargar plan'));
        const actions = elements(ActiveLoansTable({ ...props, items: [loan], canRegisterPayment }))
          .find((element) => element.type === TableActions)!.props as { actions: TableAction[] };
        expect(actions.actions.map((action) => action.key)).toEqual(['view', 'payment', 'download']);
        expect(actions.actions[1]).toMatchObject({ icon: 'payment', title: 'Registrar pago', ariaLabel: 'Registrar pago', to: `/payments/new?loanId=${loan.id}` });
        expect(actions.actions[1].onClick).toBeUndefined();
      }
    }
    const superadmin = { ...user, role: { ...user.role, isSuperAdmin: true }, permissions: [] };
    expect(markup({ items: [loan], canRegisterPayment: canAccess(superadmin, 'payments.view') && canAccess(superadmin, 'payments.create') })).toContain('aria-label="Registrar pago"');
    expect(markup({ items: [{ ...loan, status: 'CANCELLED' } as ActiveLoanListItem], canRegisterPayment: true })).not.toContain('aria-label="Registrar pago"');
    expect(markup({ canRegisterPayment: true, canExport: false, items: [loan] })).toContain('aria-label="Registrar pago"');
  });

  it('keeps View, Payment and PDF in order and inserts Edit only for authorized active loans', () => {
    const identity = { ...user, permissions: ['loans.update'] };
    const allowed = canAccess(identity, 'loans.update');
    const actions = elements(ActiveLoansTable({ ...props, items: [loan], canEdit: allowed, canRegisterPayment: true }))
      .find((element) => element.type === TableActions)!.props as { actions: TableAction[] };
    expect(actions.actions.map((action) => action.key)).toEqual(['view', 'edit', 'payment', 'download']);
    expect(actions.actions[1]).toMatchObject({ icon: 'edit', title: 'Editar préstamo', ariaLabel: 'Editar préstamo 42' });
    expect(actions.actions[1].to).toBeUndefined();
    actions.actions[1].onClick?.(); expect(onEdit).toHaveBeenCalledWith(loan);
    expect(markup({ items: [loan], canEdit: allowed })).toContain('aria-label="Editar préstamo 42"');
    expect(markup({ items: [loan], canEdit: canAccess(user, 'loans.update') })).not.toContain('Editar préstamo 42');
    expect(markup({ items: [loan], canEdit: canAccess({ ...user, role: { ...user.role, isSuperAdmin: true } }, 'loans.update') })).toContain('Editar préstamo 42');
    expect(markup({ items: [{ ...loan, status: 'UNCOLLECTIBLE' } as ActiveLoanListItem], canEdit: true })).not.toContain('Editar préstamo 42');
    expect(markup({ canEdit: true, canExport: false, items: [loan] })).toContain('Editar préstamo 42');
  });

  it('reuses the table in assigned read-only mode with status and no administrative actions', () => {
    const assigned = { ...loan, status: 'UNCOLLECTIBLE' as const };
    const html = markup({ items: [assigned], canEdit: false, canExport: false, canRegisterPayment: false, showStatus: true });
    expect(html).toContain('<th>Estado</th>');
    expect(html).toContain('>INCOBRABLE</span>');
    expect(html).toContain('Ver información del préstamo 42');
    for (const action of ['Editar préstamo', 'Registrar pago', 'Descargar plan de pago']) expect(html).not.toContain(action);
  });

  it('keeps the page filters and creation link behind centralized permissions, including superadmin', () => {
    const page = (identity: AuthIdentity, initialEntry = '/loans') => {
      const auth: AuthContextValue = { user: identity, loading: false, can: (code) => canAccess(identity, code), canAll: (codes) => codes.every((code) => canAccess(identity, code)), login: async () => {}, logout: async () => {}, changePassword: async () => {} };
      return renderToStaticMarkup(<MemoryRouter initialEntries={[initialEntry]}><AuthContext.Provider value={auth}><LoansPage /></AuthContext.Provider></MemoryRouter>);
    };
    const restricted = page(user);
    expect(restricted).toContain('Buscar por préstamo, cliente, identificación o teléfono');
    expect(restricted).toContain('Todas las periodicidades');
    expect(restricted).toContain('>Desde<');
    expect(restricted).toContain('>Hasta<');
    expect(restricted).not.toContain('href="/loans/new"');
    expect(restricted).not.toContain('Exportar Excel');
    expect(page({ ...user, permissions: [...user.permissions, 'loans.create'] })).toContain('href="/loans/new"');
    const exporter = page({ ...user, permissions: [...user.permissions, 'loans.create', 'loans.export'] });
    expect(exporter).toContain('Nuevo préstamo');
    expect(exporter).toContain('Exportar Excel');
    expect(exporter.indexOf('Nuevo préstamo')).toBeLessThan(exporter.indexOf('Exportar Excel'));
    expect(exporter).toContain('loan-list__heading-actions');
    expect(canAccess(user, 'loans.export')).toBe(false);
    expect(canAccess({ ...user, role: { ...user.role, isSuperAdmin: true } }, 'loans.export')).toBe(true);
    expect(page({ ...user, role: { ...user.role, isSuperAdmin: true } })).toContain('href="/loans/new"');
    expect(page({ ...user, role: { ...user.role, isSuperAdmin: true } })).toContain('Exportar Excel');
    const auth: AuthContextValue = { user, loading: false, can: (code) => canAccess(user, code), canAll: (codes) => codes.every((code) => canAccess(user, code)), login: async () => {}, logout: async () => {}, changePassword: async () => {} };
    expect(renderToStaticMarkup(<MemoryRouter initialEntries={['/loans?search=1-1111-1111']}><AuthContext.Provider value={auth}><LoansPageRoute /></AuthContext.Provider></MemoryRouter>)).toContain('value="1-1111-1111"');
  });
});
