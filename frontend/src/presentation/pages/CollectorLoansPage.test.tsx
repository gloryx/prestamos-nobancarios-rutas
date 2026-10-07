import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AuthContextValue } from '../hooks/auth-context';
import { AuthContext } from '../hooks/auth-context';
import { loadPermittedCollectorFinancialSummary } from '../helpers/collector-financial-summary';
import { CollectorLoansFinancialSummary, CollectorLoansPage } from './CollectorLoansPage';

const summary = { totalPlaced: '5847000.00', totalOutstanding: '5948000.00', realizedGain: '0.00', activeLoansCount: 23 };
const auth = (permissions: string[]): AuthContextValue => ({
  user: { id: 'collector-user', username: 'collector', fullName: 'Collector', permissions,
    role: { id: 'role', code: 'COLLECTOR', name: 'Collector', isSuperAdmin: false } },
  loading: false,
  can: (permission) => permissions.includes(permission),
  canAll: (required) => required.every((permission) => permissions.includes(permission)),
  login: async () => {}, logout: async () => {}, changePassword: async () => {},
});
const page = (permissions: string[]) => renderToStaticMarkup(<MemoryRouter><AuthContext.Provider value={auth(permissions)}><CollectorLoansPage /></AuthContext.Provider></MemoryRouter>);
const financial = (props: Partial<Parameters<typeof CollectorLoansFinancialSummary>[0]> = {}) => renderToStaticMarkup(
  <CollectorLoansFinancialSummary visible summary={summary} loading={false} error="" {...props} />);

describe('Mis préstamos activos', () => {
  it('publishes the active-only operational view without historical status controls or mutation actions', () => {
    const html = page(['loans.assigned.view']);
    expect(html).toContain('Mis préstamos activos');
    expect(html).toContain('Cartera activa de tus clientes actualmente asignados.');
    expect(html).not.toContain('Todos los estados');
    expect(html).not.toContain('Cancelados');
    expect(html).not.toContain('Refinanciados');
    for (const action of ['Editar préstamo', 'Registrar pago', 'Anular', 'Incobrable', 'Modificar plan']) expect(html).not.toContain(action);
  });

  it('places an independently loading financial summary before filters when permitted', () => {
    const html = page(['loans.assigned.view', 'collectors.financial-summary.view']);
    expect(html).toContain('Cargando resumen financiero');
    expect(html).toContain('Cargando préstamos');
    expect(html.indexOf('Cargando resumen financiero')).toBeLessThan(html.indexOf('Filtros de mis préstamos activos'));
  });

  it('renders the same four backend values even when a page can contain fewer loan rows', () => {
    const html = financial();
    for (const value of ['TOTAL COLOCADO', '₡5.847.000', 'TOTAL PENDIENTE', '₡5.948.000',
      'GANANCIA REALIZADA', '₡0', 'PRÉSTAMOS ACTIVOS', '>23<']) expect(html).toContain(value);
    expect(html.match(/<article/g)).toHaveLength(4);
    expect(html).toContain('collector-summary__metrics');
  });

  it('does not load or render the financial summary without its permission while keeping the list', async () => {
    const load = vi.fn(async () => summary);
    await expect(loadPermittedCollectorFinancialSummary(false, load)).resolves.toBeUndefined();
    expect(load).not.toHaveBeenCalled();
    const html = page(['loans.assigned.view']);
    expect(html).not.toContain('Resumen financiero de préstamos activos');
    expect(html).toContain('Filtros de mis préstamos activos');
    expect(html).toContain('Cargando préstamos');
  });

  it('uses the existing summary loader without deriving values from list state', async () => {
    const load = vi.fn(async () => summary);
    await expect(loadPermittedCollectorFinancialSummary(true, load)).resolves.toEqual(summary);
    expect(load).toHaveBeenCalledTimes(1);
    expect(summary.activeLoansCount).toBe(23);
  });

  it('keeps summary and list failures isolated', () => {
    const summaryError = financial({ summary: undefined, error: 'Resumen temporalmente no disponible' });
    expect(summaryError).toContain('role="alert"');
    expect(summaryError).toContain('Resumen temporalmente no disponible');
    expect(page(['loans.assigned.view', 'collectors.financial-summary.view'])).toContain('loan-list__surface');
    expect(financial()).toContain('TOTAL COLOCADO');
  });
});
