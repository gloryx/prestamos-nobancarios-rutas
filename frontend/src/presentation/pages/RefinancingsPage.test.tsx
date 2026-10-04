import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { LoanRefinancingList, RefinancingCustomerLookup } from '../../application/ports/loan-refinancing.repository';
import { RefinancingListController } from '../../application/use-cases/refinancing-list-controller';
import type { RefinancingListItem, RefinancingListResult } from '../../domain/entities/loan-refinancing';
import { HttpApiError } from '../../infrastructure/api/api-client';
import { TableActions } from '../components/TableActions';
import { RefinancingsView } from './RefinancingsPage';

const first: RefinancingListItem = {
  refinancingId: 'ref-1', refinancingDate: '2026-10-02',
  customer: { id: 'customer-1', fullName: 'Ana Solís', identification: '12345' },
  originLoan: { id: 'origin-1', loanNumber: '100' }, newLoan: { id: 'successor-1', loanNumber: '101' },
  outstandingPrincipalTransferred: '120000.00', capitalizedOutstandingInterest: '30000.00',
  newMoneyDisbursed: '50000.00', newContractualPrincipal: '200000.00',
  newInterestAmount: '40000.00', newContractualTotal: '240000.00',
};
const second: RefinancingListItem = {
  ...first, refinancingId: 'ref-2', refinancingDate: '2026-10-01',
  originLoan: { id: 'successor-1', loanNumber: '101' },
  newLoan: { id: 'successor-2', loanNumber: '102' },
  outstandingPrincipalTransferred: '160000.00', capitalizedOutstandingInterest: '40000.00',
  newMoneyDisbursed: '0.00', newContractualPrincipal: '200000.00',
  newInterestAmount: '10000.00', newContractualTotal: '210000.00',
};
const data: RefinancingListResult = { items: [first, second], page: 1, pageSize: 20, total: 31, totalPages: 2 };
const elements = (node: ReactNode): ReactElement[] => Array.isArray(node) ? node.flatMap(elements)
  : isValidElement(node) ? [node, ...elements((node.props as { children?: ReactNode }).children)] : [];

function setup() {
  const repository: LoanRefinancingList = { list: vi.fn(async (query) => ({ ...data,
    page: query.page, pageSize: query.pageSize })) };
  const customerLookup: RefinancingCustomerLookup = { search: vi.fn(async () => ({ items: [first.customer], total: 1 })) };
  const controller = new RefinancingListController(repository, customerLookup);
  const props = (overrides: Partial<Parameters<typeof RefinancingsView>[0]> = {}): Parameters<typeof RefinancingsView>[0] => ({
    state: controller.getSnapshot(), controller, canViewLoans: true, canSelectCustomer: true,
    customerOpen: false, onOpenCustomer: vi.fn(), onCloseCustomer: vi.fn(), ...overrides,
  });
  const view = (overrides: Partial<Parameters<typeof RefinancingsView>[0]> = {}) =>
    renderToStaticMarkup(<MemoryRouter><RefinancingsView {...props(overrides)} /></MemoryRouter>);
  return { controller, repository, customerLookup, props, view };
}

describe('refinancing operations listing', () => {
  it('renders the route heading, four filters and a protected next-stage creation link', () => {
    const { view } = setup();
    const html = view();
    for (const text of ['REFINANCIAMIENTOS', 'Refinanciamientos',
      'Consulta y analiza las operaciones de refinanciamiento registradas.',
      'Buscar', 'Cliente', 'Fecha desde', 'Fecha hasta', 'Seleccionar cliente',
      'Cliente, identificación o número de préstamo']) expect(html).toContain(text);
    expect(html).toContain('href="/loan-refinancings/new"');
    expect(html).not.toContain('Ganancia');
  });

  it('renders two operations separately with date, loan numbers and all six authoritative amounts', async () => {
    const { controller, view } = setup(); await controller.load();
    const html = view();
    for (const text of ['02/10/2026', '01/10/2026', 'Ana Solís', '12345', '#100', '#101', '#102',
      'Capital trasladado', 'Interés capitalizado', 'Dinero nuevo', 'Principal nuevo', 'Interés nuevo', 'Total nuevo',
      '₡120.000,00', '₡30.000,00', '₡50.000,00', '₡200.000,00', '₡40.000,00', '₡240.000,00',
      '₡160.000,00', '₡10.000,00', '₡210.000,00', '₡0,00']) expect(html).toContain(text);
    expect(html).toContain('href="/loan-refinancings/ref-1"');
    expect(html).toContain('href="/loan-refinancings/ref-2"');
    expect(html).not.toMatch(/Días ganados|Rentabilidad/);
    expect(html).toContain('role="region" aria-label="Operaciones de refinanciamiento" tabindex="0"');
  });

  it('never recomputes a historical amount from another displayed component', async () => {
    const { controller, repository, view } = setup();
    vi.mocked(repository.list).mockResolvedValueOnce({ ...data, items: [{ ...first,
      newContractualPrincipal: '123.45', newContractualTotal: '999.99' }] });
    await controller.load();
    const html = view();
    expect(html).toContain('₡123,45');
    expect(html).toContain('₡999,99');
    expect(html).toContain('₡120.000,00');
    expect(html).toContain('₡30.000,00');
    expect(html).toContain('₡50.000,00');
    expect(html).not.toContain('₡200.000,00');
  });

  it('uses compact links ordered detail/chain/origin/new and keeps chain available without loans.view', async () => {
    const { controller, props, view } = setup(); await controller.load();
    const tree = elements(RefinancingsView(props()));
    const row = tree.find((node) => node.type === TableActions)!;
    const actions = (row.props as Parameters<typeof TableActions>[0]).actions;
    expect(actions.map(({ key }) => key)).toEqual(['detail', 'chain', 'origin', 'successor']);
    expect(actions.map(({ to }) => to)).toEqual(['/loan-refinancings/ref-1',
      '/loan-refinancings/chains/loan/origin-1', '/loans/origin-1', '/loans/successor-1']);
    expect(actions.every(({ title, ariaLabel }) => title && ariaLabel)).toBe(true);
    const withoutLoanView = elements(RefinancingsView(props({ canViewLoans: false })))
      .find((node) => node.type === TableActions)!;
    expect((withoutLoanView.props as Parameters<typeof TableActions>[0]).actions.map(({ key }) => key)).toEqual(['detail', 'chain']);
    expect(view()).toContain('Ver cadena');
  });

  it('shows server total and totalPages with 10/20/50 controls, not items.length', async () => {
    const { controller, view } = setup(); await controller.load();
    let html = view();
    expect(html).toContain('Mostrando 1-2 de 31 refinanciamientos');
    expect(html).toContain('Página 1 de 2');
    expect(html).toContain('<option value="10">10</option>');
    expect(html).toContain('<option value="20" selected="">20</option>');
    expect(html).toContain('<option value="50">50</option>');
    controller.setPage(2); await controller.load();
    html = view();
    expect(html).toContain('Mostrando 21-22 de 31 refinanciamientos');
    expect(html).toContain('Página 2 de 2');
  });

  it('distinguishes empty without filters from empty with filters and handles a page becoming empty', async () => {
    const { controller, repository, view } = setup();
    vi.mocked(repository.list).mockResolvedValueOnce({ ...data, items: [], total: 0, totalPages: 0 });
    await controller.load();
    expect(view()).toContain('No hay refinanciamientos registrados.');
    controller.setFilter('search', 'none');
    vi.mocked(repository.list).mockResolvedValueOnce({ ...data, items: [], total: 0, totalPages: 0 });
    await controller.load();
    expect(view()).toContain('No se encontraron refinanciamientos con los filtros seleccionados.');
    controller.setPage(2);
    vi.mocked(repository.list).mockResolvedValueOnce({ ...data, items: [], total: 21, totalPages: 2 });
    await controller.load();
    expect(view()).toContain('No hay refinanciamientos en esta página.');
  });

  it('shows loading instead of stale rows, a sanitized error and a retry', async () => {
    const { controller, repository, view } = setup(); await controller.load();
    controller.setFilter('search', 'new');
    expect(view()).toContain('Cargando refinanciamientos…');
    expect(view()).not.toContain('₡120.000,00');
    vi.mocked(repository.list).mockRejectedValueOnce(new HttpApiError(500, 'private SQL details'));
    await controller.load();
    const error = view();
    expect(error).toContain('No se pudieron cargar los refinanciamientos.');
    expect(error).toContain('Reintentar');
    expect(error).not.toContain('private SQL details');
    expect(error).not.toContain('₡120.000,00');
    await controller.load();
    expect(view()).toContain('₡120.000,00');
  });

  it('handles invalid date ranges in presentation without showing stale rows', async () => {
    const { controller, view } = setup(); await controller.load();
    controller.setFilter('dateFrom', '2026-10-03');
    controller.setFilter('dateTo', '2026-10-02');
    expect(view()).toContain('La fecha desde no puede ser posterior a la fecha hasta.');
    expect(view()).not.toContain('₡120.000,00');
  });

  it('selects an inactive historical customer via the existing paged lookup and clears the filter', async () => {
    const { controller, props, view } = setup();
    controller.openCustomerSearch(); await controller.loadCustomers();
    const onClose = vi.fn();
    const html = view({ customerOpen: true, onCloseCustomer: onClose });
    expect(html).toContain('role="dialog"');
    expect(html).toContain('Ana Solís');
    expect(html).not.toContain('Cargando clientes');
    const row = elements(RefinancingsView(props({ customerOpen: true, onCloseCustomer: onClose })))
      .find((node) => node.type === TableActions)!;
    (row.props as Parameters<typeof TableActions>[0]).actions[0].onClick?.();
    expect(controller.getSnapshot().selectedCustomer).toMatchObject({ id: 'customer-1', fullName: 'Ana Solís' });
    expect(onClose).toHaveBeenCalledOnce();
    expect(view()).toContain('Cambiar cliente');
    expect(view()).toContain('Limpiar cliente');
    controller.selectCustomer(null);
    expect(view()).toContain('Seleccionar cliente');
  });

  it('retains the listing without customers.view and makes only the customer selector unavailable', async () => {
    const { controller, view } = setup(); await controller.load();
    const html = view({ canSelectCustomer: false, canViewLoans: false });
    expect(html).toContain('Se requiere permiso para consultar clientes.');
    expect(html).toContain('disabled="">Seleccionar cliente');
    expect(html).toContain('₡120.000,00');
    expect(html).not.toContain('href="/loans/origin-1"');
  });

  it('does not reveal backend customer lookup errors', async () => {
    const { controller, customerLookup, view } = setup();
    vi.mocked(customerLookup.search).mockRejectedValueOnce(new HttpApiError(403, 'private role details'));
    controller.openCustomerSearch(); await controller.loadCustomers();
    const html = view({ customerOpen: true });
    expect(html).toContain('No tienes permiso para consultar clientes.');
    expect(html).toContain('Reintentar');
    expect(html).not.toContain('private role details');
  });
});
