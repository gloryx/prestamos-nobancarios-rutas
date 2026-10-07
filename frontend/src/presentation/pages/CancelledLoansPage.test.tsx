import { isValidElement, type ChangeEvent, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { CancelledLoansResult } from '../../domain/entities/loan';
import { canAccess } from '../hooks/auth-permissions';
import { AuthContext, type AuthContextValue } from '../hooks/auth-context';
import { AppSidebar } from '../components/layout/AppSidebar';
import { CancelledLoansPage, CancelledLoansView } from './CancelledLoansPage';

const noop = vi.fn();
const result: CancelledLoansResult = { items: [{ id: 'loan-1', loanNumber: '42', customerName: 'Ana María López', identification: '101', startDate: '2026-01-01', cancelledDate: '2026-02-12', principal: '100.00', recoveredInterest: '25.50', totalRecovered: '125.50' }],
  total: 30, page: 1, pageSize: 20, summary: { cancelledLoansCount: 30, recoveredAmount: '30000000000000000.25', realizedProfit: '10000000000000000.10' } };
const viewProps: Parameters<typeof CancelledLoansView>[0] = { result, loading: false, error: '', search: '', startDate: '', endDate: '', page: 1, sortBy: 'cancelledDate', sortDirection: 'desc',
  onSearch: noop, onStartDate: noop, onEndDate: noop, onSort: noop, onPage: noop };
const markup = (props: Partial<typeof viewProps> = {}) => renderToStaticMarkup(<MemoryRouter><CancelledLoansView {...viewProps} {...props} /></MemoryRouter>);
const elements = (node: ReactNode): ReactElement[] => Array.isArray(node) ? node.flatMap(elements) : isValidElement(node) ? [node, ...elements((node.props as { children?: ReactNode }).children)] : [];

describe('cancelled loans read-only presentation', () => {
  it('shows exactly three all-filtered cards and seven sortable values with operational date and compact navigational View', () => {
    const html = markup();
    expect(html).toContain('Préstamos cancelados</span><strong>30</strong>');
    expect(html).toContain('Monto recuperado</span><strong>₡30.000.000.000.000.000,25</strong>');
    expect(html).toContain('Ganancia</span><strong>₡10.000.000.000.000.000,10</strong>');
    expect([...html.matchAll(/aria-sort=/g)]).toHaveLength(7);
    expect(html).toContain('#42</td>');
    expect(html).toContain('Ana María López');
    expect(html).toContain('01/01/2026');
    expect(html).toContain('12/02/2026');
    expect(html).toContain('₡100');
    expect(html).toContain('₡25,50');
    expect(html).toContain('₡125,50');
    expect(html).toContain('href="/loans/loan-1"');
    expect(html).toContain('aria-label="Ver información del préstamo 42"');
    expect(html).not.toMatch(/>Pagar<|>Personalizar<|Descargar plan/);
    expect(html).toContain('loan-list__table-wrap');
  });

  it('renders loading/error/empty/legacy and beyond-page states without undefined values', () => {
    const empty = { ...result, items: [], total: 0, summary: { cancelledLoansCount: 0, recoveredAmount: '0.00', realizedProfit: '0.00' } };
    expect(markup({ result: empty, loading: true })).toContain('Cargando préstamos cancelados');
    expect(markup({ loading: true })).not.toContain('₡30.000.000.000.000.000,25');
    expect(markup({ result: empty, error: 'No disponible' })).toContain('role="alert">No disponible');
    expect(markup({ result: empty })).toContain('No hay préstamos cancelados.');
    expect(markup({ result: empty, search: 'Ana' })).toContain('No se encontraron préstamos cancelados');
    expect(markup({ result: { ...result, items: [] }, page: 3 })).toContain('No hay préstamos en esta página.');
    expect(markup({ result: { ...result, items: [{ ...result.items[0], cancelledDate: null, recoveredInterest: '0.00', totalRecovered: '0.00' }] } })).toContain('>—</td>');
    expect(markup({ result: empty })).toContain('₡0');
    expect(markup({ result: empty })).not.toContain('undefined');
  });

  it('wires date-only inputs, search, all seven server sort keys and page changes through callbacks', () => {
    const onSearch = vi.fn(), onStartDate = vi.fn(), onEndDate = vi.fn(), onSort = vi.fn(), onPage = vi.fn();
    const tree = elements(CancelledLoansView({ ...viewProps, onSearch, onStartDate, onEndDate, onSort, onPage }));
    const inputs = tree.filter((element) => element.type === 'input');
    expect(inputs).toHaveLength(3);
    expect(inputs.slice(1).map((element) => (element.props as { type?: string }).type)).toEqual(['date', 'date']);
    for (const [index, value] of ['Ana', '2026-01-01', '2026-12-31'].entries()) {
      (inputs[index].props as { onChange: (event: ChangeEvent<HTMLInputElement>) => void }).onChange({ target: { value } } as ChangeEvent<HTMLInputElement>);
    }
    expect(onSearch).toHaveBeenCalledWith('Ana'); expect(onStartDate).toHaveBeenCalledWith('2026-01-01'); expect(onEndDate).toHaveBeenCalledWith('2026-12-31');
    const headers = tree.filter((element) => element.type === 'th' && (element.props as { 'aria-sort'?: string })['aria-sort']);
    expect(headers).toHaveLength(7);
    headers.forEach((header) => { const button = elements(header)[1]; (button.props as { onClick: () => void }).onClick(); });
    expect(onSort.mock.calls.map(([key]) => key)).toEqual(['loanNumber', 'customer', 'startDate', 'cancelledDate', 'principal', 'recoveredInterest', 'totalRecovered']);
    const next = tree.find((element) => element.type === 'button' && (element.props as { children?: string }).children === 'Siguiente')!;
    (next.props as { onClick: () => void }).onClick();
    expect(onPage).toHaveBeenCalledWith(2);
    expect(markup({ sortBy: 'totalRecovered', sortDirection: 'asc', page: 2 })).toContain('Página 2 de 2 · 30 préstamos');
  });

  it('uses centralized permissions and activates only the matching loan sidebar link', () => {
    const user = { id: 'user', username: 'u', fullName: 'User', role: { id: 'role', code: 'ROLE', name: 'Role', isSuperAdmin: false }, permissions: [] as string[] };
    expect(canAccess(user, 'loans.view')).toBe(false);
    const auth = (identity: typeof user): AuthContextValue => ({ user: identity, loading: false, can: (code) => canAccess(identity, code), canAll: (codes) => codes.every((code) => canAccess(identity, code)),
      login: async () => {}, logout: async () => {}, changePassword: async () => {} });
    const sidebar = (identity: typeof user, path = '/loans/cancelled') => renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><AuthContext.Provider value={auth(identity)}><AppSidebar isOpen onNavigate={noop} /></AuthContext.Provider></MemoryRouter>);
    expect(sidebar(user)).not.toContain('href="/loans/cancelled"');
    const allowed = sidebar({ ...user, permissions: ['loans.view'] });
    const links = [...allowed.matchAll(/<a[^>]*href="([^"]+)"[^>]*>/g)];
    expect(links.find((link) => link[1] === '/loans/cancelled')?.[0]).toContain('nav-link--active');
    expect(links.find((link) => link[1] === '/loans')?.[0]).not.toContain('nav-link--active');
    expect(sidebar({ ...user, role: { ...user.role, isSuperAdmin: true } })).toContain('href="/loans/cancelled"');
    const path = '/loans/uncollectible-management';
    expect(sidebar({ ...user, permissions: ['loans.status.reactivate'] }, path)).not.toContain(`href="${path}"`);
    const management = sidebar({ ...user, permissions: ['loans.view'] }, path);
    const managementLinks = [...management.matchAll(/<a[^>]*href="([^"]+)"[^>]*>/g)];
    expect(managementLinks.filter((link) => link[0].includes('nav-link--active')).map((link) => link[1])).toEqual([path]);
    expect(management).toContain('nav-group--active');
    expect(sidebar({ ...user, role: { ...user.role, isSuperAdmin: true } }, path)).toContain(`href="${path}"`);
  });

  it('starts the page in a loading state until the read-only request completes', () => {
    expect(renderToStaticMarkup(<CancelledLoansPage />)).toContain('Cargando préstamos cancelados');
  });
});
