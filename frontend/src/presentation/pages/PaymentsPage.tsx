import { useEffect, useState } from 'react';
import { paymentApi, type PaymentContext, type PaymentLoan } from '../../infrastructure/api/payment.api';
import { useAuth } from '../hooks/auth-context';

export function PaymentsPage() {
  const { can } = useAuth();
  const [loans, setLoans] = useState<PaymentLoan[]>([]);
  const [selected, setSelected] = useState<PaymentContext | null>(null);
  const [error, setError] = useState('');
  const [amount, setAmount] = useState('');
  const [methodId, setMethodId] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { paymentApi.listLoans().then((result) => setLoans(result.items)).catch((reason: Error) => setError(reason.message)); }, []);
  const register = async () => {
    if (!selected || !amount || !methodId) return;
    setBusy(true); setError('');
    try { await paymentApi.create({ loanId: selected.summary.loanId, amount, paymentDate: new Date().toISOString().slice(0, 10), methodId, idempotencyKey: crypto.randomUUID() }); setSelected(await paymentApi.context(selected.summary.loanId)); setAmount(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Payment registration failed.'); }
    finally { setBusy(false); }
  };
  return <main className="page-content"><h1>Payments</h1>{error && <p role="alert">{error}</p>}<div className="card-grid">{loans.map((loan) => <button key={loan.id} type="button" onClick={() => paymentApi.context(loan.id).then(setSelected).catch((reason: Error) => setError(reason.message))}>{loan.loanNumber} — {loan.customerName} — {loan.financialBalance}</button>)}</div>{selected && <section aria-label="Payment context"><h2>Loan {selected.summary.loanNumber}</h2><p>Financial balance: {selected.balances.financialBalance}</p>{can('payments.create') && <form onSubmit={(event) => { event.preventDefault(); void register(); }}><label>Amount<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label><label>Payment method<input value={methodId} onChange={(event) => setMethodId(event.target.value)} required /></label><button type="submit" disabled={busy}>{busy ? 'Registering…' : 'Register payment'}</button></form>}<h3>Payment history</h3><ul>{selected.payments.map((payment) => <li key={payment.id}>{payment.paymentDate}: {payment.amount} ({payment.status})</li>)}</ul></section>}</main>;
}
