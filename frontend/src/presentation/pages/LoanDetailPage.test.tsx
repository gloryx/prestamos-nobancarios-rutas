import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoanOperationalDetail } from '../../domain/entities/loan';
import { LoanDetailPage } from './LoanDetailPage';

const mocks = vi.hoisted(() => ({
  detail: vi.fn(), report: vi.fn(), setState: vi.fn(),
  stale: { id: 'loan-1', customerId: 'customer-1', loanNumber: '7', customerName: 'Ana', identification: '101',
    startDate: '2026-01-01', principal: '100.00', interestAmount: '0.00', totalAmount: '100.00', pendingTotal: '100.00',
    financialBalance: '100.00', frequencyName: 'Diaria', preferredPaymentMethod: 'Efectivo', disbursementPaymentMethod: 'Efectivo',
    status: 'ACTIVE', intervalUnit: 'DAY', intervalValue: 1, createdByName: 'Staff', updatedAt: '2026-01-01T00:00:00Z',
    plan: [], validPayments: [],
  } as LoanOperationalDetail,
}));
vi.mock('react', async (importOriginal) => ({ ...await importOriginal<typeof import('react')>(),
  useEffect: vi.fn(), useState: vi.fn((initial: unknown) => [initial === undefined ? mocks.stale : initial, mocks.setState]),
}));
vi.mock('react-router-dom', async (importOriginal) => ({ ...await importOriginal<typeof import('react-router-dom')>(), useParams: () => ({ id: 'loan-1' }) }));
vi.mock('../hooks/auth-context', () => ({ useAuth: () => ({ can: () => true }) }));
vi.mock('../../infrastructure/api/loan.api', () => ({ loanApi: { detail: mocks.detail } }));
vi.mock('../../infrastructure/reports/loan-payment-plan-report.service', () => ({ generateLoanPaymentPlanReport: mocks.report }));

const elements = (node: ReactNode): ReactElement[] => Array.isArray(node) ? node.flatMap(elements)
  : isValidElement(node) ? [node, ...elements((node.props as { children?: ReactNode }).children)] : [];
const clickReport = () => (elements(LoanDetailPage()).find((item) => item.type === 'button')?.props as { onClick: () => void }).onClick();

describe('loan detail receipt action', () => {
  beforeEach(() => { mocks.detail.mockReset(); mocks.report.mockReset(); mocks.setState.mockReset(); });

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
});
