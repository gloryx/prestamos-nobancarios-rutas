import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LoanAnnulmentController, type LoanAnnulmentPort } from '../../application/use-cases/loan-annulment-controller';
import type { AnnullableLoanItem, AnnulledLoanItem, LoanAnnulmentReceipt } from '../../domain/entities/loan';
import { HttpApiError } from '../../infrastructure/api/api-client';
import { LoanAnnulmentDialog } from '../components/LoanAnnulmentDialog';
import { TableActions } from '../components/TableActions';
import { canAccess } from '../hooks/auth-permissions';
import { LoanAnnulmentManagementView } from './LoanAnnulmentManagementPage';

const candidate: AnnullableLoanItem = { loanId: 'loan-1', loanNumber: '123', customer: { id: 'customer-1', identification: '101', fullName: 'Ana López' },
  startDate: '2026-09-01', principal: '100.00', interestAmount: '20.00', totalAmount: '120.00', status: 'ACTIVE',
  disbursement: { id: 'disbursement-1', amount: '100.00', date: '2026-09-01' } };
const annulled: AnnulledLoanItem = { ...candidate, status: 'ANNULLED', annulledAt: '2026-10-01T00:00:00.000001Z',
  annulledBusinessDate: '2026-09-30', reason: 'Préstamo creado por error', actorId: 'actor', disbursementResolution: 'NOT_DELIVERED' };
const receipt: LoanAnnulmentReceipt = { loanId: candidate.loanId, status: 'ANNULLED', annulledAt: annulled.annulledAt,
  annulledBusinessDate: annulled.annulledBusinessDate, reason: annulled.reason, disbursementResolution: 'NOT_DELIVERED' };
const summary = { total: 1, capital: '100.00', interest: '20.00', contractualTotal: '120.00' };
const elements = (node: ReactNode): ReactElement[] => Array.isArray(node) ? node.flatMap(elements)
  : isValidElement(node) ? [node, ...elements((node.props as { children?: ReactNode }).children)] : [];

function setup(allowed = true) {
  const api = {
    getAnnullableLoans: vi.fn<LoanAnnulmentPort['getAnnullableLoans']>(async (query) => ({ items: [candidate], total: 1,
      page: query.page ?? 1, pageSize: query.pageSize ?? 20, summary })),
    getAnnulledLoans: vi.fn<LoanAnnulmentPort['getAnnulledLoans']>(async (query) => ({ items: [annulled], total: 1,
      page: query.page ?? 1, pageSize: query.pageSize ?? 20, summary })),
    annulLoan: vi.fn<LoanAnnulmentPort['annulLoan']>(async () => receipt),
  };
  let keys = 0;
  const controller = new LoanAnnulmentController(api, () => `key-${++keys}`, () => allowed);
  const tree = (canAnnul = allowed) => elements(LoanAnnulmentManagementView({ state: controller.getSnapshot(), controller, canAnnul }));
  const view = (canAnnul = allowed) => renderToStaticMarkup(<LoanAnnulmentManagementView state={controller.getSnapshot()} controller={controller} canAnnul={canAnnul} />);
  const begin = () => {
    const actions = tree().find((element) => element.type === TableActions)!;
    (actions.props as Parameters<typeof TableActions>[0]).actions[0].onClick?.();
  };
  const dialog = () => tree().find((element) => element.type === LoanAnnulmentDialog)!.props as Parameters<typeof LoanAnnulmentDialog>[0];
  return { api, controller, view, begin, dialog };
}

describe('loan annulment action', () => {
  it('keeps both tabs for view-only users, hides the action, and permits central superadmin bypass', async () => {
    const identity = { id: 'user', username: 'tester', fullName: 'Tester', role: { id: 'role', code: 'TEST', name: 'Test', isSuperAdmin: false }, permissions: ['loans.view'] };
    const viewer = setup(false); await viewer.controller.load();
    expect(viewer.view(canAccess(identity, 'loans.status.annul'))).toContain('Candidatos');
    expect(viewer.view()).toContain('Anulados');
    expect(viewer.view()).not.toContain('Anular préstamo 123');
    expect(viewer.controller.begin(candidate)).toBe(false);
    const editor = setup(); await editor.controller.load();
    expect(editor.view()).toContain('aria-label="Anular préstamo 123"');
    editor.controller.setActiveTab('ANNULLED'); await new Promise((resolve) => setTimeout(resolve, 0));
    expect(editor.view()).not.toContain('Anular préstamo 123');
    expect(canAccess({ ...identity, permissions: [], role: { ...identity.role, isSuperAdmin: true } }, 'loans.status.annul')).toBe(true);
  });

  it('opens the context-rich modal and blocks missing resolution, blank or overlong reason', async () => {
    const { controller, api, begin, dialog, view } = setup(); await controller.load(); begin();
    const html = view();
    for (const text of ['Anular préstamo #123', 'Ana López', 'Identificación: 101', 'Capital: ₡100,00', 'Interés: ₡20,00',
      'Total contractual: ₡120,00', 'Fecha de inicio: 01/09/2026', 'El dinero no fue entregado al cliente',
      'El dinero fue devuelto íntegramente', 'Esta operación es definitiva', 'Confirmá únicamente', 'Motivo']) expect(html).toContain(text);
    expect(html).toMatch(/type="submit" disabled=""/);
    dialog().onReason('Préstamo creado por error');
    expect(view()).toMatch(/type="submit" disabled=""/);
    dialog().onResolution('NOT_DELIVERED');
    expect(view()).not.toMatch(/type="submit" disabled=""/);
    dialog().onReason(' '); expect(view()).toMatch(/type="submit" disabled=""/);
    dialog().onReason('a'.repeat(501)); expect(view()).toMatch(/type="submit" disabled=""/);
    expect(await controller.submit()).toBe(false);
    expect(api.annulLoan).not.toHaveBeenCalled();
    dialog().onClose(); expect(view()).not.toContain('role="dialog"');
  });

  it.each(['NOT_DELIVERED', 'RETURNED_IN_FULL'] as const)('submits exact %s payload and shows the annulled tab after success', async (resolution) => {
    const { controller, api, begin, dialog, view } = setup(); await controller.load(); begin();
    dialog().onResolution(resolution); dialog().onReason('  Préstamo creado por error  ');
    expect(await controller.submit()).toBe(true);
    expect(api.annulLoan).toHaveBeenCalledWith('loan-1', { reason: 'Préstamo creado por error', disbursementResolution: resolution,
      idempotencyKey: 'key-1' });
    expect(api.getAnnulledLoans).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().activeTab).toBe('ANNULLED');
    expect(view()).toContain('Préstamo anulado correctamente.');
    expect(view()).not.toContain('role="dialog"');
  });

  it('shows 409, refreshes candidates and does not remove a still-eligible loan optimistically', async () => {
    const { controller, api, begin, dialog, view } = setup(); await controller.load(); begin();
    dialog().onResolution('NOT_DELIVERED'); dialog().onReason('Revisado');
    api.annulLoan.mockRejectedValueOnce(new HttpApiError(409, 'El préstamo tiene pagos válidos.'));
    expect(await controller.submit()).toBe(false);
    expect(api.getAnnullableLoans).toHaveBeenCalledTimes(2);
    expect(view()).toContain('El préstamo tiene pagos válidos.');
    expect(view()).toContain('role="dialog"');
    expect(controller.getSnapshot().items[0].loanId).toBe('loan-1');
  });

  it('closes on 404, refreshes candidates and shows the controlled error', async () => {
    const { controller, api, begin, dialog, view } = setup(); await controller.load(); begin();
    dialog().onResolution('NOT_DELIVERED'); dialog().onReason('Revisado');
    api.annulLoan.mockRejectedValueOnce(new HttpApiError(404, 'El préstamo no existe.'));
    expect(await controller.submit()).toBe(false);
    expect(view()).not.toContain('role="dialog"');
    expect(view()).toContain('El préstamo no existe.');
    expect(api.getAnnullableLoans).toHaveBeenCalledTimes(2);
  });

  it('locks double submit while pending and keeps the same key for unchanged retries but rotates it after edits', async () => {
    const { controller, api, begin, dialog, view } = setup(); await controller.load(); begin();
    dialog().onResolution('NOT_DELIVERED'); dialog().onReason('Revisado');
    let reject!: (error: Error) => void;
    api.annulLoan.mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
    const pending = controller.submit();
    expect(await controller.submit()).toBe(false);
    expect(api.annulLoan).toHaveBeenCalledTimes(1);
    expect(view()).toContain('Anulando…');
    reject(new Error('Network failure')); expect(await pending).toBe(false);
    expect(view()).toContain('No se pudo anular el préstamo.');
    api.annulLoan.mockRejectedValueOnce(new Error('Network failure'));
    await controller.submit();
    expect(api.annulLoan.mock.calls[1][1].idempotencyKey).toBe('key-1');
    dialog().onReason('Otro motivo');
    api.annulLoan.mockRejectedValueOnce(new Error('Network failure'));
    await controller.submit();
    expect(api.annulLoan.mock.calls[2][1].idempotencyKey).toBe('key-2');
    dialog().onResolution('RETURNED_IN_FULL');
    await controller.submit();
    expect(api.annulLoan.mock.calls[3][1].idempotencyKey).toBe('key-3');
  });
});
