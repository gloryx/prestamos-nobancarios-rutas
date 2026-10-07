import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { LoanRefinancingLookup } from '../../application/ports/loan-refinancing.repository';
import { RefinancingStepOneController } from '../../application/use-cases/refinancing-step-one-controller';
import { RefinancingConditionsController } from '../../application/use-cases/refinancing-conditions-controller';
import type { RefinancingLoanSearchItem, RefinancingPreview } from '../../domain/entities/loan-refinancing';
import type { PaymentFrequency } from '../../domain/entities/payment-frequency';
import { HttpApiError } from '../../infrastructure/api/api-client';
import { TableActions } from '../components/TableActions';
import { NewRefinancingPage, RefinancingStepOneView } from './NewRefinancingPage';
import { RefinancingConditionsView } from './RefinancingConditionsView';

const loan: RefinancingLoanSearchItem = { loanId: 'loan-1', loanNumber: '100',
  customer: { id: 'customer-1', fullName: 'Ana Solís', identification: '10203040' },
  status: 'ACTIVE', startDate: '2026-09-01', principal: '150000.00', interestAmount: '30000.00',
  totalAmount: '180000.00', paidAmount: '30000.00', financialBalance: '150000.00' };
const preview: RefinancingPreview = { loanId: loan.loanId, loanNumber: loan.loanNumber,
  customer: { id: loan.customer.id, name: loan.customer.fullName, identification: loan.customer.identification },
  status: 'ACTIVE', startDate: loan.startDate, principal: loan.principal, interestAmount: loan.interestAmount,
  totalAmount: loan.totalAmount, paidAmount: '30000.00', paidPrincipal: '30000.00', paidInterest: '0.00',
  outstandingPrincipal: '120000.00', outstandingInterest: '30000.00', financialBalance: '150000.00',
  pendingPlanAmount: '150000.00', minimumRequiredPayment: '30000.00', remainingToMinimum: '0.00',
  eligible: true, reasonCode: null, reason: null, reasons: [], baseline: 'a'.repeat(64) };

const elements = (node: ReactNode): ReactElement[] => Array.isArray(node) ? node.flatMap(elements)
  : isValidElement(node) ? [node, ...elements((node.props as { children?: ReactNode }).children)] : [];

function setup() {
  const api: LoanRefinancingLookup = {
    search: vi.fn(async (query) => ({ items: [loan], total: 21, page: query.page, pageSize: query.pageSize })),
    preview: vi.fn(async () => preview),
  };
  const controller = new RefinancingStepOneController(api);
  const view = () => renderToStaticMarkup(<MemoryRouter><RefinancingStepOneView state={controller.getSnapshot()} controller={controller} /></MemoryRouter>);
  const tree = () => elements(RefinancingStepOneView({ state: controller.getSnapshot(), controller }));
  return { api, controller, view, tree };
}

describe('refinancing origin selection', () => {
  it('starts at Step 1, without auto-selecting or enabling nonexistent steps', async () => {
    const { controller, api, view } = setup();
    const initial = view();
    expect(initial).toContain('Nuevo refinanciamiento');
    expect(initial).toContain('aria-current="step"');
    expect(initial).toContain('Nuevas condiciones');
    expect(initial).toContain('Confirmación');
    expect(initial).toContain('Seleccionar préstamo origen');
    expect(initial).toContain('Buscar por número de préstamo, identificación o nombre');
    expect(initial).toContain('disabled="" aria-label="Continuar a nuevas condiciones"');
    expect(initial).not.toContain('CONTRATO ACTUAL');
    expect(api.preview).not.toHaveBeenCalled();
    await controller.load();
    expect(api.search).toHaveBeenCalledWith({ search: '', page: 1, pageSize: 20 });
    expect(view()).toContain('Seleccionar préstamo 100');
  });

  it('uses server paging, compact actions, CRC/date formatting and resets the page when searching', async () => {
    const { api, controller, view, tree } = setup(); await controller.load();
    const html = view();
    for (const text of ['#100', 'Ana Solís', '10203040', '01/09/2026', '₡150.000', '₡30.000',
      '₡180.000', 'ACTIVO', 'Página 1 de 2 · 21 préstamos']) expect(html).toContain(text);
    const actions = tree().find((node) => node.type === TableActions)!;
    expect((actions.props as Parameters<typeof TableActions>[0]).actions.map((item) => item.key)).toEqual(['select']);
    controller.setPage(2); await controller.load();
    expect(api.search).toHaveBeenLastCalledWith({ search: '', page: 2, pageSize: 20 });
    controller.setSearch('Ana');
    expect(controller.getSnapshot()).toMatchObject({ page: 1, search: 'Ana', list: null, loadingList: true });
    await controller.load();
    expect(api.search).toHaveBeenLastCalledWith({ search: 'Ana', page: 1, pageSize: 20 });
    controller.setPageSize(10); await controller.load();
    expect(api.search).toHaveBeenLastCalledWith({ search: 'Ana', page: 1, pageSize: 10 });
  });

  it('loads the preview on selection and displays distinct paid and outstanding components', async () => {
    const { api, controller, view, tree } = setup(); await controller.load();
    const actions = tree().find((node) => node.type === TableActions)!;
    (actions.props as Parameters<typeof TableActions>[0]).actions[0].onClick?.();
    expect(view()).toContain('Consultando situación financiera');
    expect(controller.canContinue()).toBe(false);
    await Promise.resolve(); await Promise.resolve();
    expect(api.preview).toHaveBeenCalledWith('loan-1');
    expect(controller.canContinue()).toBe(true);
    const html = view();
    for (const fragment of ['Préstamo #100', 'CONTRATO ACTUAL', 'PAGOS RECIBIDOS', 'SALDO PENDIENTE',
      'Total pagado</dt><dd>₡30.000', 'Capital recuperado</dt><dd>₡30.000',
      'Interés recuperado</dt><dd>₡0', 'Capital pendiente</dt><dd>₡120.000',
      'Interés pendiente</dt><dd>₡30.000', 'Saldo financiero</dt><dd>₡150.000',
      'Pagos válidos acumulados</dt><dd>₡30.000', 'Mínimo requerido</dt><dd>₡30.000',
      'Monto faltante</dt><dd>₡0', 'Cumple el mínimo requerido para refinanciar.']) expect(html).toContain(fragment);
    expect(html).not.toMatch(/Interés cubierto|Interés pagado/);
    expect(html).toContain('disabled="" aria-label="Continuar a nuevas condiciones"');
  });

  it('shows an exact shortfall and does not treat paidAmount as paidInterest', async () => {
    const { api, controller, view } = setup();
    vi.mocked(api.preview).mockResolvedValueOnce({ ...preview, paidAmount: '20000.00', paidPrincipal: '20000.00',
      paidInterest: '0.00', outstandingPrincipal: '130000.00', financialBalance: '160000.00',
      pendingPlanAmount: '160000.00', eligible: false, remainingToMinimum: '10000.00',
      reasonCode: 'MINIMUM_PAYMENT_NOT_MET', reasons: ['MINIMUM_PAYMENT_NOT_MET'] });
    await controller.select(loan.loanId);
    expect(controller.canContinue()).toBe(false);
    expect(view()).toContain('Faltan ₡10.000 para alcanzarlo.');
    expect(view()).toContain('Interés recuperado</dt><dd>₡0');
    expect(view()).not.toContain('Cumple el mínimo requerido');
  });

  it('sanitizes financial integrity errors and handles other non-eligibility reasons', async () => {
    const { api, controller, view } = setup();
    vi.mocked(api.preview).mockResolvedValueOnce({ ...preview, eligible: false, reasonCode: 'FINANCIAL_INTEGRITY_ERROR',
      reason: 'Database internal detail', reasons: ['FINANCIAL_INTEGRITY_ERROR'] });
    await controller.select(loan.loanId);
    expect(view()).toContain('requiere revisión');
    expect(view()).not.toContain('Database internal detail');
    for (const reasonCode of ['LOAN_NOT_ACTIVE', 'NO_OUTSTANDING_BALANCE'] as const) {
      vi.mocked(api.preview).mockResolvedValueOnce({ ...preview, eligible: false, reasonCode, reasons: [reasonCode] });
      await controller.select(loan.loanId);
      expect(view()).toContain(reasonCode === 'LOAN_NOT_ACTIVE' ? 'Solo se pueden refinanciar préstamos activos.' :
        'no tiene saldo pendiente para refinanciar.');
    }
  });

  it('clears selection, preview and errors and ignores an obsolete preview response', async () => {
    const { api, controller, view } = setup();
    let resolve!: (value: RefinancingPreview) => void;
    vi.mocked(api.preview).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const pending = controller.select(loan.loanId);
    expect(controller.getSnapshot()).toMatchObject({ originLoanId: loan.loanId, loadingPreview: true, originPreview: null });
    controller.clearSelection();
    resolve(preview); await pending;
    expect(controller.getSnapshot()).toMatchObject({ originLoanId: null, originPreview: null, previewError: null });
    expect(view()).toContain('Seleccionar préstamo origen');
    expect(view()).not.toContain('CONTRATO ACTUAL');
    expect(controller.canContinue()).toBe(false);
  });

  it('ignores stale search results and renders loading, empty and controlled API errors', async () => {
    const { api, controller, view } = setup();
    let finish!: (value: Awaited<ReturnType<LoanRefinancingLookup['search']>>) => void;
    vi.mocked(api.search).mockImplementationOnce(() => new Promise((done) => { finish = done; }));
    const stale = controller.load();
    expect(view()).toContain('Cargando préstamos activos');
    controller.setSearch('new');
    finish({ items: [loan], total: 1, page: 1, pageSize: 20 }); await stale;
    expect(controller.getSnapshot().list).toBeNull();
    vi.mocked(api.search).mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    await controller.load(); expect(view()).toContain('No se encontraron préstamos activos con esta búsqueda.');
    for (const [error, text] of [
      [new HttpApiError(403, 'Private permission failure'), 'No tienes permiso'],
      [new TypeError('network'), 'No se pudo conectar'],
    ] as const) {
      vi.mocked(api.search).mockRejectedValueOnce(error); await controller.load();
      expect(view()).toContain(text); expect(view()).not.toContain('Private permission failure');
      expect(controller.getSnapshot().list).toBeNull();
    }
  });

  it('shows preview 404/409/network errors with a retry, never stale financial data', async () => {
    const { api, controller, view } = setup();
    for (const [error, text] of [
      [new HttpApiError(404, 'missing'), 'El préstamo ya no está disponible'],
      [new HttpApiError(409, 'stale'), 'La información del préstamo cambió'],
      [new TypeError('network'), 'No se pudo conectar'],
    ] as const) {
      vi.mocked(api.preview).mockRejectedValueOnce(error); await controller.select(loan.loanId);
      const html = view();
      expect(html).toContain(text); expect(html).toContain('Reintentar');
      expect(html).not.toContain('CONTRATO ACTUAL');
      expect(controller.canContinue()).toBe(false);
    }
    await controller.select(loan.loanId);
    expect(view()).toContain('CONTRATO ACTUAL');
    controller.clearSelection();
    expect(view()).not.toContain('CONTRATO ACTUAL');
  });

  it('renders the hook-based page with a supplied controller without POST or auto-selection', () => {
    const { controller, api } = setup();
    const html = renderToStaticMarkup(<MemoryRouter><NewRefinancingPage controller={controller} /></MemoryRouter>);
    expect(html).toContain('Nuevo refinanciamiento');
    expect(api.preview).not.toHaveBeenCalled();
  });

  it('allows eligible origins into Step 2, displays exact new debt and refreshes preview on return', async () => {
    const { controller, api } = setup();
    const conditions = new RefinancingConditionsController({ load: vi.fn(async () => ({
      frequencies: [{ id: 'daily', name: 'Diaria', intervalUnit: 'DAY', intervalValue: 1, order: 1, isActive: true } satisfies PaymentFrequency],
      methods: [{ id: 'cash', name: 'Efectivo', order: 1, isActive: true }],
    })) });
    await controller.select(loan.loanId);
    const first = RefinancingStepOneView({ state: controller.getSnapshot(), controller, onContinue: () => {
      conditions.setPreview(controller.getSnapshot().originPreview!);
      controller.goToConditions();
      void conditions.loadOptions();
    } });
    const next = elements(first).find((element) => (element.props as { 'aria-label'?: string })['aria-label'] === 'Continuar a nuevas condiciones')!;
    expect((next.props as { disabled: boolean }).disabled).toBe(false);
    (next.props as { onClick: () => void }).onClick();
    await conditions.loadOptions();
    conditions.setConditions({ refinancingDate: '2026-10-01', newMoney: '20000.00', newInterestAmount: '10000.00',
      paymentFrequencyId: 'daily', preferredPaymentMethodId: 'cash', disbursementPaymentMethodId: 'cash', count: '3' });
    const page = () => renderToStaticMarkup(<MemoryRouter><NewRefinancingPage controller={controller} conditionsController={conditions} /></MemoryRouter>);
    const html = page();
    for (const text of ['Nuevas condiciones y plan de pagos', 'Capital anterior pendiente', '₡120.000',
      'Interés anterior pendiente capitalizado', '₡30.000', 'Nuevo capital contractual', '₡170.000',
      'Nuevo total a pagar', '₡180.000', 'DESEMBOLSO REAL', '₡20.000',
      '3 Cuotas programadas', '₡60.000', 'Volver al préstamo origen']) expect(html).toContain(text);
    expect(html).toContain('aria-label="Continuar a confirmación"');
    expect(html).not.toContain('disabled="" aria-label="Continuar a confirmación"');
    expect(html).not.toContain('Seleccionar préstamo origen</h2>');
    const conditionTree = RefinancingConditionsView({ state: conditions.getSnapshot(), controller: conditions,
      onBack: () => controller.goToOrigin() });
    const backButton = elements(conditionTree).find((element) => (element.props as { children?: string }).children === 'Volver al préstamo origen')!;
    (backButton.props as { onClick: () => void }).onClick();
    expect(controller.getSnapshot()).toMatchObject({ step: 'ORIGIN', loadingPreview: true });
    await Promise.resolve(); await Promise.resolve();
    expect(api.preview).toHaveBeenCalledTimes(2);
    expect(controller.canContinue()).toBe(true);
    expect(conditions.getSnapshot().conditions.newMoney).toBe('20000.00');
  });

  it('keeps ineligible loans on Step 1 and shows read-only option failure on Step 2', async () => {
    const { api, controller } = setup();
    vi.mocked(api.preview).mockResolvedValueOnce({ ...preview, eligible: false, reasonCode: 'MINIMUM_PAYMENT_NOT_MET' });
    await controller.select(loan.loanId);
    controller.goToConditions();
    expect(controller.getSnapshot().step).toBe('ORIGIN');
    await controller.select(loan.loanId);
    controller.goToConditions();
    const conditions = new RefinancingConditionsController({ load: vi.fn(async () => { throw new HttpApiError(403, 'private'); }) });
    conditions.setPreview(preview);
    await conditions.loadOptions();
    const html = renderToStaticMarkup(<RefinancingConditionsView state={conditions.getSnapshot()} controller={conditions} onBack={() => {}} />);
    expect(html).toContain('No tienes permiso para consultar las periodicidades');
    expect(html).toContain('Reintentar');
    expect(html).not.toContain('private');
    expect(conditions.canProceed()).toBe(false);
  });
});
