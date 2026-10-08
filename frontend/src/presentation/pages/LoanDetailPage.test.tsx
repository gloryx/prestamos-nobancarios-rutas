import { isValidElement, useEffect, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthIdentity } from '../../domain/entities/auth';
import type { LoanOperationalDetail } from '../../domain/entities/loan';
import { LoanDetailPage } from './LoanDetailPage';
import { LoanEditDialog } from '../components/LoanEditDialog';
import { Icon } from '../components/layout/Icon';
import { canAccess } from '../hooks/auth-permissions';

const mocks = vi.hoisted(() => ({
   detail: vi.fn(), report: vi.fn(), setState: vi.fn(), can: vi.fn(), editing: false, superadmin: false,
   permissions: ['loans.update', 'loans.export', 'payments.view', 'payments.create'] as string[],
  stale: { id: 'loan-1', customerId: 'customer-1', loanNumber: '7', customerName: 'Ana', identification: '101',
    startDate: '2026-01-01', principal: '100.00', interestAmount: '0.00', totalAmount: '100.00', pendingTotal: '100.00',
    financialBalance: '100.00', frequencyName: 'Diaria', preferredPaymentMethod: 'Efectivo', disbursementPaymentMethod: 'Efectivo',
    status: 'ACTIVE', intervalUnit: 'DAY', intervalValue: 1, createdByName: 'Staff', updatedAt: '2026-01-01T00:00:00Z',
    plan: [], validPayments: [], collectionProjection: { overdueAmount: '0.00', scheduledAmount: '0.00', totalSuggestedAmount: '0.00', operationalDate: null, operationalDateKind: null },
  } as LoanOperationalDetail,
}));
const initialLoan = { ...mocks.stale };
const identity: AuthIdentity = { id: 'user', username: 'u', fullName: 'User', role: { id: 'role', code: 'ROLE', name: 'Role', isSuperAdmin: false }, permissions: [] };
vi.mock('react', async (importOriginal) => ({ ...await importOriginal<typeof import('react')>(),
    useEffect: vi.fn(), useState: vi.fn((initial: unknown) => [initial === undefined ? mocks.stale : initial === false ? mocks.editing : initial, mocks.setState]),
    useCallback: (callback: unknown) => callback,
}));
vi.mock('react-router-dom', async (importOriginal) => ({ ...await importOriginal<typeof import('react-router-dom')>(), useParams: () => ({ id: 'loan-1' }) }));
vi.mock('../hooks/auth-context', () => ({ useAuth: () => ({ can: mocks.can }) }));
vi.mock('../../infrastructure/api/loan.api', () => ({ loanApi: { detail: mocks.detail } }));
vi.mock('../../infrastructure/reports/loan-payment-plan-report.service', () => ({ generateLoanPaymentPlanReport: mocks.report }));

const elements = (node: ReactNode): ReactElement[] => Array.isArray(node) ? node.flatMap(elements)
  : isValidElement(node) ? [node, ...elements((node.props as { children?: ReactNode }).children)] : [];
const clickReport = () => (elements(LoanDetailPage()).find((item) => item.type === 'button' && (item.props as { children?: ReactNode }).children === 'Descargar plan de pago')?.props as { onClick: () => void }).onClick();
const paymentLink = () => elements(LoanDetailPage()).find((item) => item.type === Link);

describe('loan detail actions', () => {
  beforeEach(() => {
    mocks.detail.mockReset(); mocks.report.mockReset(); mocks.setState.mockReset(); mocks.can.mockReset(); vi.mocked(useEffect).mockClear();
    mocks.editing = false; mocks.superadmin = false; mocks.stale = { ...initialLoan };
    mocks.permissions = ['loans.update', 'loans.export', 'payments.view', 'payments.create'];
    mocks.can.mockImplementation((code: string) => canAccess({ ...identity, permissions: mocks.permissions, role: { ...identity.role, isSuperAdmin: mocks.superadmin } }, code));
    mocks.setState.mockImplementation((value: unknown) => { if (value && typeof value === 'object' && 'status' in value) mocks.stale = value as LoanOperationalDetail; });
  });

  it('loads the latest loan on click instead of exporting the mount-time loan', async () => {
    const fresh = { ...mocks.stale, status: 'CANCELLED', financialBalance: '0.00', validPayments: [
      { id: 'payment', paymentDate: '2026-02-01', amount: '100.00', status: 'VALID' as const },
    ] };
    let resolve!: (loan: LoanOperationalDetail) => void;
    mocks.detail.mockReturnValue(new Promise<LoanOperationalDetail>((done) => { resolve = done; }));
    clickReport();
    expect(mocks.detail).toHaveBeenCalledWith('loan-1');
    expect(mocks.report).not.toHaveBeenCalled();
    resolve(fresh);
    await vi.waitFor(() => expect(mocks.report).toHaveBeenCalledExactlyOnceWith(fresh));
  });

  it('reports a fresh read failure instead of exporting stale data', async () => {
    mocks.detail.mockRejectedValue(new Error('Read failed'));
    clickReport();
    await vi.waitFor(() => expect(mocks.setState).toHaveBeenCalledWith('Read failed'));
    expect(mocks.report).not.toHaveBeenCalled();
  });
  it('gates the natural header Edit action to active authorized loans and refreshes detail after a receipt', async () => {
    const active = elements(LoanDetailPage());
    const edit = active.find((item) => item.type === 'button' && (item.props as { children?: ReactNode }).children === 'Editar préstamo')!;
    (edit.props as { onClick: () => void }).onClick();
    expect(mocks.setState).toHaveBeenCalledWith(true);
    mocks.editing = true;
    const dialog = elements(LoanDetailPage()).find((item) => item.type === LoanEditDialog)!;
    const refreshed = { ...mocks.stale, interestAmount: '2.00', totalAmount: '102.00' };
    mocks.detail.mockResolvedValue(refreshed);
    await (dialog.props as { onSaved: () => Promise<void> }).onSaved();
    expect(mocks.detail).toHaveBeenCalledWith('loan-1'); expect(mocks.setState).toHaveBeenCalledWith(refreshed);
    (dialog.props as { onClose: () => void }).onClose();
    expect(mocks.setState).toHaveBeenCalledWith(false);
    mocks.editing = false;
    expect(elements(LoanDetailPage()).some((item) => item.type === LoanEditDialog)).toBe(false);
    mocks.editing = true;
    mocks.permissions = mocks.permissions.filter((code) => code !== 'loans.update');
    expect(elements(LoanDetailPage()).some((item) => item.type === LoanEditDialog)).toBe(false);
    expect(elements(LoanDetailPage()).some((item) => item.type === 'button' && (item.props as { children?: ReactNode }).children === 'Editar préstamo')).toBe(false);
    mocks.permissions.push('loans.update'); mocks.stale.status = 'CANCELLED';
    expect(elements(LoanDetailPage()).some((item) => item.type === 'button' && (item.props as { children?: ReactNode }).children === 'Editar préstamo')).toBe(false);
  });

  it('places the payment Link between Edit and Download with the existing icon and exact loan route', () => {
    const header = elements(LoanDetailPage()).find((item) => (item.props as { className?: string }).className === 'loan-detail__actions')!;
    expect(elements(header).filter((item) => item.type === 'button' || item.type === Link).map((item) => item.type === Link ? 'Registrar pago' : (item.props as { children: string }).children))
      .toEqual(['Editar préstamo', 'Registrar pago', 'Descargar plan de pago']);
    const action = paymentLink()!;
    expect(action.props).toMatchObject({ className: 'button button--secondary', to: '/payments/new?loanId=loan-1' });
    expect((action.props as { children: ReactNode[] }).children).toContain('Registrar pago');
    expect((action.props as { onClick?: unknown }).onClick).toBeUndefined();
    expect(elements(action).some((item) => item.type === Icon && (item.props as { name: string }).name === 'payment')).toBe(true);
    expect(elements(LoanDetailPage()).some((item) => item.type === LoanEditDialog)).toBe(false);
  });

  it.each([
    { permissions: ['payments.view'] },
    { permissions: ['payments.create'] },
    { permissions: [] as string[] },
  ])('hides payment without both permissions (%j)', ({ permissions }) => {
    mocks.permissions = ['loans.update', 'loans.export', ...permissions];
    expect(paymentLink()).toBeUndefined();
    const header = elements(LoanDetailPage());
    expect(header.some((item) => item.type === 'button' && (item.props as { children?: ReactNode }).children === 'Editar préstamo')).toBe(true);
    expect(header.some((item) => item.type === 'button' && (item.props as { children?: ReactNode }).children === 'Descargar plan de pago')).toBe(true);
  });

  it('allows superadmin without explicit payment permissions via the central helper', () => {
    mocks.permissions = []; mocks.superadmin = true;
    expect((paymentLink()?.props as { to?: string } | undefined)?.to).toBe('/payments/new?loanId=loan-1');
    mocks.stale.status = 'CANCELLED';
    expect(paymentLink()).toBeUndefined();
  });

  it('does not depend on loan edit or export permission to show payment', () => {
    mocks.permissions = ['loans.view', 'payments.view', 'payments.create'];
    expect(paymentLink()).toBeDefined();
    expect(elements(LoanDetailPage()).some((item) => item.type === 'button')).toBe(false);
  });

  it.each(['CANCELLED', 'REFINANCED', 'UNCOLLECTIBLE', 'ANNULLED'])('hides payment for %s detail regardless of permission', (status) => {
    mocks.stale.status = status;
    expect(paymentLink()).toBeUndefined();
    expect(elements(LoanDetailPage()).some((item) => item.type === 'button' && (item.props as { children?: ReactNode }).children === 'Descargar plan de pago')).toBe(true);
  });

  it.each([['ACTIVE', 'CANCELLED', false], ['UNCOLLECTIBLE', 'ACTIVE', true]] as const)(
    'uses loaded status instead of stale origin (%s to %s)', async (origin, loaded, visible) => {
      mocks.stale.status = origin;
      expect(Boolean(paymentLink())).toBe(origin === 'ACTIVE');
      vi.mocked(useEffect).mockClear();
      const fresh = { ...mocks.stale, status: loaded };
      mocks.detail.mockResolvedValueOnce(fresh);
      LoanDetailPage();
      vi.mocked(useEffect).mock.calls[0][0]();
      await vi.waitFor(() => expect(mocks.setState).toHaveBeenCalledWith(fresh));
      expect(Boolean(paymentLink())).toBe(visible);
    },
  );
});
