import { isValidElement, type ChangeEvent, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LoanAnnulmentController, type LoanAnnulmentPort } from '../../application/use-cases/loan-annulment-controller';
import type { AnnullableLoanItem, AnnulledLoanItem, AnnulmentResult } from '../../domain/entities/loan';
import { LoanAnnulmentManagementPage, LoanAnnulmentManagementView } from './LoanAnnulmentManagementPage';
import { AuthContext } from '../hooks/auth-context';

const candidate: AnnullableLoanItem = { loanId: 'loan-1', loanNumber: '123', customer: { id: 'customer-1', identification: '101', fullName: 'Ana López' },
  startDate: '2026-09-01', principal: '100.00', interestAmount: '20.00', totalAmount: '120.00', status: 'ACTIVE',
  disbursement: { id: 'disbursement-1', amount: '100.00', date: '2026-09-01' } };
const annulled: AnnulledLoanItem[] = [
  { ...candidate, status: 'ANNULLED', annulledAt: '2026-10-02T00:00:00.000000Z', annulledBusinessDate: '2026-10-01',
    reason: 'No se entregó', actorId: 'user-1', disbursementResolution: 'NOT_DELIVERED' },
  { ...candidate, loanId: 'loan-2', loanNumber: '124', status: 'ANNULLED', annulledAt: '2026-10-02T00:00:00.000000Z',
    annulledBusinessDate: '2026-10-01', reason: '', actorId: 'user-1', disbursementResolution: 'RETURNED_IN_FULL' },
];
const summary = { total: 3, capital: '300000.00', interest: '60000.00', contractualTotal: '360000.00' };
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const elements = (node: ReactNode): ReactElement[] => Array.isArray(node) ? node.flatMap(elements)
  : isValidElement(node) ? [node, ...elements((node.props as { children?: ReactNode }).children)] : [];

function setup(total = 3) {
  const api = {
    getAnnullableLoans: vi.fn<LoanAnnulmentPort['getAnnullableLoans']>(async (query) => ({ items: [candidate], total,
      page: query.page ?? 1, pageSize: query.pageSize ?? 20, summary })),
    getAnnulledLoans: vi.fn<LoanAnnulmentPort['getAnnulledLoans']>(async (query) => ({ items: annulled, total,
      page: query.page ?? 1, pageSize: query.pageSize ?? 20, summary } as AnnulmentResult<AnnulledLoanItem>)),
    annulLoan: vi.fn<LoanAnnulmentPort['annulLoan']>(),
  };
  const controller = new LoanAnnulmentController(api, () => 'key-1', () => false);
  const view = () => renderToStaticMarkup(<LoanAnnulmentManagementView state={controller.getSnapshot()} controller={controller} />);
  const tree = () => elements(LoanAnnulmentManagementView({ state: controller.getSnapshot(), controller }));
  const button = (name: string) => tree().find((element) => element.type === 'button' &&
    ((element.props as { children?: ReactNode }).children === name ||
      (element.props as { 'aria-label'?: string })['aria-label'] === name))!;
  const click = (name: string) => (button(name).props as { onClick: () => void }).onClick();
  return { api, controller, view, tree, click };
}
async function loadCandidates(controller: LoanAnnulmentController) {
  controller.setActiveTab('CANDIDATES');
  await tick();
}

describe('loan annulment management', () => {
  it('renders the hidden page with annulled loans first and selected, and loads only their endpoint', async () => {
    const { api, controller, view } = setup();
    const initial = renderToStaticMarkup(<AuthContext.Provider value={{ loading: false, can: () => false, canAll: () => false,
      login: async () => {}, logout: async () => {}, changePassword: async () => {} }}>
      <LoanAnnulmentManagementPage controller={controller} /></AuthContext.Provider>);
    expect(initial).toContain('Gestión de anulaciones');
    expect(initial).toMatch(/id="loan-annulment-annulled-tab"[^>]*aria-selected="true"/);
    expect(initial.indexOf('>Anulados</button>')).toBeLessThan(initial.indexOf('>Candidatos</button>'));
    expect(initial).toContain('Cargando préstamos');
    await controller.load();
    expect(api.getAnnulledLoans).toHaveBeenCalledWith({ page: 1, pageSize: 20, sortBy: 'annulledDate', sortDir: 'desc' });
    expect(api.getAnnullableLoans).not.toHaveBeenCalled();
    expect(view()).toContain('#123');
    expect(view()).toContain('Ana López');
    expect(view()).toContain('101');
    expect(view()).not.toContain('Anular préstamo');
  });

  it('uses backend summary, not row totals, for all four CRC cards and the server total for pagination', async () => {
    const { controller, view } = setup(31); await controller.load();
    const html = view();
    expect(html).toContain('TOTAL</span><strong>3</strong>');
    expect(html).toContain('CAPITAL</span><strong>₡300.000</strong>');
    expect(html).toContain('INTERÉS</span><strong>₡60.000</strong>');
    expect(html).toContain('TOTAL CONTRACTUAL</span><strong>₡360.000</strong>');
    expect(html).toContain('Página 1 de 2 · 31 préstamos');
    expect(html).toContain('loan-list__table-wrap');
  });

  it('displays annulled loan details and switches tabs without requesting both initially', async () => {
    const { api, controller, click, view } = setup(); await controller.load();
    expect(api.getAnnulledLoans).toHaveBeenCalledWith({ page: 1, pageSize: 20, sortBy: 'annulledDate', sortDir: 'desc' });
    expect(api.getAnnullableLoans).not.toHaveBeenCalled();
    const html = view();
    expect(html).toContain('role="tabpanel" aria-labelledby="loan-annulment-annulled-tab"');
    expect(html).toContain('Anulado');
    expect(html).toContain('01/10/2026');
    expect(html).not.toContain('02/10/2026');
    expect(html).toContain('No entregado');
    expect(html).toContain('Devuelto íntegramente');
    expect(html).toContain('No se entregó');
    expect(html).toContain('loan-management__reason">—</td>');
    click('Candidatos'); await tick();
    expect(api.getAnnullableLoans).toHaveBeenCalledWith({ page: 1, pageSize: 20, sortBy: 'loanNumber', sortDir: 'desc' });
  });

  it('sends filters, server sorting and page changes without sorting or filtering the rows locally', async () => {
    const { api, controller, view, tree, click } = setup(31); await loadCandidates(controller);
    const inputs = tree().filter((element) => element.type === 'input');
    for (const [index, value] of ['Ana', '2026-01-01', '2026-10-01'].entries()) {
      (inputs[index].props as { onChange: (event: ChangeEvent<HTMLInputElement>) => void }).onChange({ target: { value } } as ChangeEvent<HTMLInputElement>);
    }
    await tick();
    const capital = tree().find((element) => typeof element.type === 'function' && element.type.name === 'SortHeader' &&
      (element.props as { label?: string }).label === 'Capital')!;
    (capital.props as { onSort: () => void }).onSort(); await tick();
    click('Siguiente'); await tick();
    expect(api.getAnnullableLoans).toHaveBeenLastCalledWith({ search: 'Ana', startDate: '2026-01-01', endDate: '2026-10-01',
      page: 2, pageSize: 20, sortBy: 'principal', sortDir: 'asc' });
    expect(view()).toContain('#123');
    click('Anulados'); await tick();
    expect(api.getAnnulledLoans).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'Ana', page: 1, startDate: '2026-01-01' }));
  });

  it('shows visible errors and keeps prior rows and cards during and after a failed refresh', async () => {
    const { api, controller, view, click } = setup(); await loadCandidates(controller);
    let reject!: (error: Error) => void;
    api.getAnnullableLoans.mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
    click('Refrescar préstamos');
    expect(view()).toContain('#123');
    expect(view()).toContain('₡300.000');
    reject(new Error('No se pudo actualizar.')); await tick();
    expect(view()).toContain('role="alert">No se pudo actualizar.');
    expect(view()).toContain('Se muestran datos anteriores');
    expect(view()).toContain('#123');
    expect(view()).toContain('₡300.000');
  });
});
