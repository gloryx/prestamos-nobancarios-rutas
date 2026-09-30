import { paymentApi, type PaymentLoan } from '../../infrastructure/api/payment.api';

export const PAGE_SIZE = 20;
export type LoanList = { loans: PaymentLoan[]; total: number; page: number };

export async function loadPaymentLoanPage(search: string, page: number, api: Pick<typeof paymentApi, 'listLoans'> = paymentApi): Promise<LoanList> {
  let requestedPage = page;
  for (;;) {
    const result = await api.listLoans(search, requestedPage, PAGE_SIZE);
    const lastPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
    if (requestedPage <= lastPage) return { loans: result.items, total: result.total, page: requestedPage };
    requestedPage = lastPage;
  }
}

type PendingLoanList = { search: string; page: number; promise: Promise<LoanList> };
export function reusePendingLoanPage(pending: { current: PendingLoanList | null }, search: string, page: number, api: Pick<typeof paymentApi, 'listLoans'> = paymentApi): Promise<LoanList> {
  if (pending.current?.search === search && pending.current.page === page) return pending.current.promise;
  const promise = loadPaymentLoanPage(search, page, api);
  pending.current = { search, page, promise };
  void promise.then(
    () => { if (pending.current?.promise === promise) pending.current = null; },
    () => { if (pending.current?.promise === promise) pending.current = null; },
  );
  return promise;
}

export async function refreshPaymentLoanPage(lock: { current: boolean }, search: string, page: number, api: Pick<typeof paymentApi, 'listLoans'> = paymentApi): Promise<LoanList | undefined> {
  if (lock.current) return undefined;
  lock.current = true;
  try { return await loadPaymentLoanPage(search, page, api); }
  finally { lock.current = false; }
}
