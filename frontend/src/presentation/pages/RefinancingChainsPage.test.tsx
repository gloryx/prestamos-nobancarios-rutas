import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { LoanRefinancingChains, RefinancingCustomerLookup } from '../../application/ports/loan-refinancing.repository';
import { RefinancingChainController } from '../../application/use-cases/refinancing-chain-controller';
import type { RefinancingChain } from '../../domain/entities/loan-refinancing';
import { HttpApiError } from '../../infrastructure/api/api-client';
import { RefinancingChainDetail, RefinancingChainsView } from './RefinancingChainsPage';

const customer = { id: 'customer-1', fullName: 'Ana Solís', identification: '1-2345' };
const chain = (suffix = ''): RefinancingChain => ({
  rootLoanId: `loan-1${suffix}`, terminalLoanId: `loan-2${suffix}`, customer,
  startedAt: '2026-09-01', lastRefinancingDate: '2026-09-02',
  loans: [
    { loanId: `loan-1${suffix}`, loanNumber: `100${suffix}`, status: 'REFINANCED', startDate: '2026-09-01',
      principal: '100000.00', interestAmount: '20000.00', totalAmount: '120000.00', paidAmount: '72000.00',
      paidPrincipal: '72000.00', paidInterest: '0.00', outstandingPrincipal: '28000.00',
      outstandingInterest: '20000.00', financialBalance: '48000.00', isRoot: true, isTerminal: false },
    { loanId: `loan-2${suffix}`, loanNumber: `101${suffix}`, status: 'CANCELLED', startDate: '2026-09-02',
      principal: '100000.00', interestAmount: '20000.00', totalAmount: '120000.00', paidAmount: '120000.00',
      paidPrincipal: '100000.00', paidInterest: '20000.00', outstandingPrincipal: '0.00',
      outstandingInterest: '0.00', financialBalance: '0.00', isRoot: false, isTerminal: true },
  ],
  transitions: [{ refinancingId: `ref-1${suffix}`, refinancingDate: '2026-09-02',
    originLoanId: `loan-1${suffix}`, newLoanId: `loan-2${suffix}`, outstandingPrincipalTransferred: '28000.00',
    capitalizedOutstandingInterest: '20000.00', newMoneyDisbursed: '52000.00',
    newContractualPrincipal: '100000.00', newInterestAmount: '20000.00', newContractualTotal: '120000.00' }],
  summary: { loanCount: 2, refinancingCount: 1, totalOutstandingPrincipalTransferred: '28000.00',
    totalCapitalizedOutstandingInterest: '20000.00', totalNewMoneyDisbursed: '52000.00',
    totalNewInterestContracted: '20000.00', totalPaymentsReceived: '192000.00',
    totalPrincipalApplied: '172000.00', totalInterestApplied: '20000.00',
    rootDisbursedAmount: '100000.00', totalCashActuallyDisbursed: '152000.00' },
});

const setup = () => {
  const repository: LoanRefinancingChains = { byLoan: vi.fn(async () => chain()),
    byCustomer: vi.fn(async () => ({ customer, chains: [chain(), chain('-b')] })) };
  const lookup: RefinancingCustomerLookup = { search: vi.fn(async () => ({ items: [customer], total: 1 })) };
  const controller = new RefinancingChainController(repository, lookup);
  const props = (loanId?: string): Parameters<typeof RefinancingChainsView>[0] => ({
    state: controller.getSnapshot(), controller, loanId, canSelectCustomer: true, canViewLoans: true,
    customerOpen: false, onOpenCustomer: vi.fn(), onCloseCustomer: vi.fn(),
  });
  const view = (loanId?: string) => renderToStaticMarkup(<MemoryRouter><RefinancingChainsView {...props(loanId)} /></MemoryRouter>);
  return { controller, repository, props, view };
};

describe('refinancing chain presentation', () => {
  it('renders the ordered capital-first history and every authoritative transition amount', () => {
    const html = renderToStaticMarkup(<MemoryRouter><RefinancingChainDetail chain={chain()} canViewLoans /></MemoryRouter>);
    for (const text of ['PRÉSTAMO INICIAL', 'PRÉSTAMO TERMINAL', 'REFINANCIAMIENTO', 'REFINANCIADO', 'CANCELADO',
      'Pagado', '₡72.000,00', 'Capital recuperado', 'Interés recuperado', '₡0,00', 'Capital pendiente', '₡28.000,00',
      'Interés pendiente', '₡20.000,00', 'Saldo financiero', 'Saldo trasladado al siguiente refinanciamiento.',
      'Capital trasladado', 'Interés capitalizado', 'Dinero nuevo', '₡52.000,00', 'Principal nuevo',
      'Interés nuevo', 'Total nuevo', 'Desembolso inicial', 'Efectivo desembolsado', '₡152.000,00',
      'Pagos recibidos', '₡192.000,00', 'Capital aplicado', '₡172.000,00', 'Interés aplicado']) expect(html).toContain(text);
    expect(html.indexOf('Préstamo #100')).toBeLessThan(html.indexOf('REFINANCIAMIENTO'));
    expect(html.indexOf('REFINANCIAMIENTO')).toBeLessThan(html.indexOf('Préstamo #101'));
    expect(html).toContain('href="/loans/loan-1"');
    expect(html).toContain('href="/loan-refinancings/ref-1"');
    expect(html).not.toMatch(/Efectivo neto recuperado|Días ganados|Ganancia|Rentabilidad|ROI|Utilidad/);
  });

  it('uses backend loan and transition fields without recomputing their financial values', () => {
    const authoritative = chain();
    authoritative.loans[0] = { ...authoritative.loans[0], outstandingPrincipal: '999.99',
      outstandingInterest: '888.88', financialBalance: '777.77' };
    authoritative.transitions[0] = { ...authoritative.transitions[0], capitalizedOutstandingInterest: '0.00',
      newMoneyDisbursed: '0.00', newContractualPrincipal: '123.45', newContractualTotal: '987.65' };
    const html = renderToStaticMarkup(<MemoryRouter><RefinancingChainDetail chain={authoritative} canViewLoans={false} /></MemoryRouter>);
    for (const amount of ['₡999,99', '₡888,88', '₡777,77', '₡123,45', '₡987,65']) expect(html).toContain(amount);
    expect(html.match(/₡0,00/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain('href="/loans/');
  });

  it('shows no-selection, permission and empty-customer states without requesting a chain', async () => {
    const { controller, repository, props, view } = setup();
    expect(view()).toContain('Seleccione un cliente para consultar sus cadenas.');
    expect(repository.byCustomer).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(<MemoryRouter><RefinancingChainsView {...props()} canSelectCustomer={false} /></MemoryRouter>))
      .toContain('El selector de clientes no está disponible con tus permisos.');
    controller.selectCustomer(customer);
    vi.mocked(repository.byCustomer).mockResolvedValueOnce({ customer, chains: [] });
    await controller.loadCustomer(customer.id);
    expect(view()).toContain('Este cliente no tiene cadenas de refinanciamiento.');
    controller.selectCustomer(null);
    expect(view()).toContain('Seleccione un cliente');
  });

  it('keeps multiple chains separate and only aggregates additive descriptive summaries', async () => {
    const { controller, view } = setup();
    controller.selectCustomer(customer);
    await controller.loadCustomer(customer.id);
    const html = view();
    expect(html).toContain('Resumen del cliente');
    expect(html).toContain('₡56.000,00');
    expect(html).toContain('₡40.000,00');
    expect(html).toContain('₡104.000,00');
    expect(html).toContain('₡384.000,00');
    expect(html).toContain('₡304.000,00');
    expect(html).toContain('href="/loan-refinancings/chains/loan/loan-1"');
    expect(html).toContain('href="/loan-refinancings/chains/loan/loan-1-b"');
    expect(html.match(/CADENA DE REFINANCIAMIENTO/g)).toHaveLength(2);
  });

  it('does not present incomplete cash totals when one root disbursement is unavailable', async () => {
    const { controller, repository, view } = setup();
    const incomplete = chain('-b');
    incomplete.summary.rootDisbursedAmount = null;
    incomplete.summary.totalCashActuallyDisbursed = null;
    vi.mocked(repository.byCustomer).mockResolvedValueOnce({ customer, chains: [chain(), incomplete] });
    controller.selectCustomer(customer);
    await controller.loadCustomer(customer.id);
    expect(view()).toContain('<dt>Efectivo desembolsado</dt><dd>No disponible</dd>');
  });

  it.each([
    [new HttpApiError(403, 'private'), 'No tienes permiso para consultar cadenas'],
    [new HttpApiError(404, 'private'), 'El préstamo no existe o no tiene una cadena'],
    [new HttpApiError(409, 'private', 'CHAIN_INTEGRITY_ERROR'), 'inconsistencia de integridad'],
    [new TypeError('offline'), 'No se pudo conectar al servidor'],
    [new HttpApiError(500, 'private SQL'), 'No se pudieron cargar las cadenas'],
  ])('sanitizes direct-chain failure %s', async (failure, message) => {
    const { controller, repository, view } = setup();
    vi.mocked(repository.byLoan).mockRejectedValueOnce(failure);
    await controller.loadLoan('loan');
    const html = view('loan');
    expect(html).toContain(message);
    expect(html).toContain('Reintentar');
    expect(html).not.toContain('private SQL');
  });
});
