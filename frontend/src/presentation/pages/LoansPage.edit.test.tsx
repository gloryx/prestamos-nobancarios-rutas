import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { LoanEditDialog } from '../components/LoanEditDialog';
import { ActiveLoansTable, LoansPage } from './LoansPage';

const state = vi.hoisted(() => ({ slots: [] as unknown[], index: 0, ref: { current: 0 }, list: vi.fn() }));
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const index = state.index++; if (!(index in state.slots)) state.slots[index] = initial;
    return [state.slots[index], (value: unknown) => { state.slots[index] = typeof value === 'function' ? (value as (before: unknown) => unknown)(state.slots[index]) : value; }]; },
  useRef: () => state.ref, useCallback: (fn: unknown) => fn, useEffect: () => {},
}));
vi.mock('react-router-dom', async (original) => ({ ...await original<typeof import('react-router-dom')>(), useNavigate: () => vi.fn() }));
vi.mock('../hooks/auth-context', () => ({ useAuth: () => ({ can: () => true }) }));
vi.mock('../../infrastructure/api/loan.api', () => ({ loanApi: { list: state.list } }));
const elements = (node: ReactNode): ReactElement[] => Array.isArray(node) ? node.flatMap(elements)
  : isValidElement(node) ? [node, ...elements((node.props as { children?: ReactNode }).children)] : [];
const row = { id: 'loan-1', loanNumber: '42', startDate: '2026-01-01', principal: '100.00', interestAmount: '20.00', totalAmount: '120.00', customerName: 'Ana', identification: '101', frequencyName: 'Mensual', pendingTotal: '60.00', isOverdue: false };
const render = () => { state.index = 0; return LoansPage(); };

beforeEach(() => { state.slots = []; state.slots[0] = [row]; state.slots[9] = 1; state.slots[10] = false; state.ref.current = 0; state.list.mockReset(); });

it('opens the shared editor from the list and publishes a fresh list only after the receipt callback', async () => {
  const table = elements(render()).find((item) => item.type === ActiveLoansTable)!;
  (table.props as { onEdit: (loan: typeof row) => void }).onEdit(row);
  const dialog = elements(render()).find((item) => item.type === LoanEditDialog)!;
  expect((dialog.props as { loanId: string }).loanId).toBe('loan-1');
  const fresh = { ...row, interestAmount: '20.01', totalAmount: '120.01', pendingTotal: '60.01' };
  state.list.mockResolvedValueOnce({ items: [fresh], total: 1 });
  await (dialog.props as { onSaved: () => Promise<void> }).onSaved();
  expect(state.list).toHaveBeenCalledWith({ page: 1, pageSize: 20, search: '', frequencyId: '', fromDate: '', toDate: '', sortBy: 'number', sortOrder: 'desc' });
  expect(state.slots[0]).toEqual([fresh]);
  (dialog.props as { onClose: () => void }).onClose();
  expect(elements(render()).some((item) => item.type === LoanEditDialog)).toBe(false);
});
