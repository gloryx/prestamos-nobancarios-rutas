import { useEffect, useRef, useState, type ReactElement } from 'react';
import { collectorPrecollections } from '../../app/collector-precollections';
import type { CollectorPrecollectionDetail } from '../../domain/entities/collector-precollection';
import type { AssignedLoanDetail, AssignedLoanListItem } from '../../domain/entities/loan';
import { interpretApplicationError, applicationFieldError, type ApplicationFieldError } from '../../application/errors/application-error';
import { loanApi } from '../../infrastructure/api/loan.api';
import { costaRicaDateOnly } from '../../shared/utils/date';
import { formatCRC } from '../../shared/utils/money';
import { MoneyInput } from '../components/MoneyInput';
import { PrecollectionReceiptActions } from '../components/PrecollectionReceiptActions';
import { positiveMoney, retryKeyFor, validatePrecollectionCapture, type RetryKeyState } from '../helpers/stage3b';

type Form = { amount: string; effectiveDate: string; paymentMethodId: string; reference: string; notes: string };
const initialForm = (): Form => ({ amount: '', effectiveDate: costaRicaDateOnly(), paymentMethodId: '', reference: '', notes: '' });

export function CollectorPrecollectionCapturePage(): ReactElement {
  const [search, setSearch] = useState(''); const [loans, setLoans] = useState<AssignedLoanListItem[]>([]);
  const [loading, setLoading] = useState(true); const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState(''); const [selected, setSelected] = useState<AssignedLoanDetail>();
  const [form, setForm] = useState<Form>(initialForm); const [fieldErrors, setFieldErrors] = useState<ApplicationFieldError[]>([]);
  const [busy, setBusy] = useState(false); const [success, setSuccess] = useState('');
  const [receipt, setReceipt] = useState<CollectorPrecollectionDetail>();
  const retry = useRef<RetryKeyState | undefined>(undefined);

  useEffect(() => { let active = true; const timer = setTimeout(() => { setLoading(true); void loanApi.assignedList({ page: 1, pageSize: 20, search, status: 'ACTIVE', sortBy: 'customer', sortOrder: 'asc' })
    .then((result) => { if (active) { setLoans(result.items); setError(''); } })
    .catch(() => { if (active) setError('No se pudieron buscar los préstamos activos asignados.'); })
    .finally(() => { if (active) setLoading(false); }); }, 250); return () => { active = false; clearTimeout(timer); }; }, [search]);

  const selectLoan = async (loan: AssignedLoanListItem) => {
    setDetailLoading(true); setError(''); setSuccess('');
    try { const value = await loanApi.assignedDetail(loan.id); setSelected(value); setForm(initialForm()); setReceipt(undefined); retry.current = undefined; }
    catch { setSelected(undefined); setError('No se pudo cargar el detalle autorizado del préstamo.'); }
    finally { setDetailLoading(false); }
  };
  const completeContract = selected && typeof selected.financialBalance === 'string' && typeof selected.reservedPrecollections === 'string' &&
    typeof selected.operationalBalance === 'string' && Array.isArray(selected.activePaymentMethods);
  const payload = selected ? { customerId: selected.customerId, loanId: selected.id, paymentMethodId: form.paymentMethodId,
    custodyTreatment: 'COLLECTOR_HELD' as const, amount: positiveMoney(form.amount), effectiveDate: form.effectiveDate,
    reference: form.reference.trim() || undefined, notes: form.notes.trim() || undefined } : undefined;

  const submit = async () => {
    if (!payload || !completeContract || busy) return;
    const local = validatePrecollectionCapture(payload, busy);
    if (local.length) { setFieldErrors(local); return; }
    const key = retryKeyFor(payload, retry.current); retry.current = key; setBusy(true); setError(''); setFieldErrors([]); setSuccess('');
    try {
      const created = await collectorPrecollections.create({ ...payload, idempotencyKey: key.key });
      setSelected((current) => current ? { ...current, financialBalance: created.financialBalance,
        reservedPrecollections: created.reservedPrecollections, operationalBalance: created.operationalBalance } : current);
      setReceipt(created);
      setSuccess('Cobro preliminar registrado. Queda pendiente de liquidación y confirmación.'); setForm(initialForm()); retry.current = undefined;
    } catch (cause) { const interpreted = interpretApplicationError(cause, 'No se pudo registrar el cobro preliminar.'); setError(interpreted.message); setFieldErrors(interpreted.fieldErrors); }
    finally { setBusy(false); }
  };
  const field = (name: string) => applicationFieldError(fieldErrors, name);

  return <section className="stage3b stage3b--collector" aria-labelledby="precollection-capture-title">
    <header className="stage3b__heading"><div><span className="eyebrow">COBRADOR</span><h1 id="precollection-capture-title">Registrar cobro</h1><p>Registro preliminar. El pago se aplicará al préstamo únicamente después de su liquidación y confirmación.</p></div></header>
    {error && <div className="catalog-message catalog-message--error" role="alert">{error}</div>}{success && <div className="success-message" role="status">{success}</div>}
    <div className="stage3b__layout"><section className="stage3b__panel" aria-label="Buscar préstamo asignado"><label className="stage3b__field">Buscar cliente o préstamo<input value={search} placeholder="Nombre, identificación o préstamo" onChange={(event) => setSearch(event.target.value)} /></label>
      {loading ? <p className="stage3b__message">Buscando préstamos…</p> : !loans.length ? <p className="stage3b__message">No hay préstamos activos asignados que coincidan.</p> : <div className="stage3b__cards">{loans.map((loan) => <article className="stage3b-card" key={loan.id}><div><strong>{loan.customerName}</strong><span>{loan.identification}</span><span>Préstamo {loan.loanNumber} · {formatCRC(loan.pendingTotal)}</span></div><button className="button button--secondary" type="button" onClick={() => void selectLoan(loan)}>Seleccionar</button></article>)}</div>}
    </section>
    <section className="stage3b__panel" aria-label="Datos del cobro preliminar">{detailLoading ? <p className="stage3b__message">Cargando detalle financiero…</p> : !selected ? <p className="stage3b__message">Seleccioná un préstamo para continuar.</p> : !completeContract ? <div className="catalog-message catalog-message--error" role="alert"><strong>Registro no disponible.</strong><br />El servidor no entregó el saldo operativo reservado o las formas de pago activas. No se inventarán estos datos.</div> : <>
      <div className="stage3b__summary"><article><span>Saldo financiero confirmado</span><strong>{formatCRC(selected.financialBalance)}</strong></article><article><span>Precolecciones pendientes</span><strong>{formatCRC(selected.reservedPrecollections)}</strong></article><article><span>Saldo estimado</span><strong>{formatCRC(selected.operationalBalance)}</strong></article></div>
      <div className="stage3b__form"><label className="stage3b__field">Monto recibido<MoneyInput value={form.amount} aria-invalid={Boolean(field('amount'))} onChange={(amount) => { setForm({ ...form, amount }); setSuccess(''); }} />{field('amount') && <small className="form-error">{field('amount')}</small>}</label>
        <label className="stage3b__field">Fecha real del cobro<input type="date" max={costaRicaDateOnly()} value={form.effectiveDate} aria-invalid={Boolean(field('effectiveDate'))} onChange={(event) => setForm({ ...form, effectiveDate: event.target.value })} />{field('effectiveDate') && <small className="form-error">{field('effectiveDate')}</small>}</label>
        <label className="stage3b__field">Forma de pago<select value={form.paymentMethodId} aria-invalid={Boolean(field('paymentMethodId'))} onChange={(event) => setForm({ ...form, paymentMethodId: event.target.value })}><option value="">Seleccionar</option>{selected.activePaymentMethods.map((method) => <option value={method.id} key={method.id}>{method.name}</option>)}</select>{field('paymentMethodId') && <small className="form-error">{field('paymentMethodId')}</small>}</label>
        <label className="stage3b__field">Referencia (opcional)<input value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} /></label><label className="stage3b__field stage3b__field--wide">Notas (opcional)<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
      </div><p className="stage3b__notice">Este registro es preliminar y queda pendiente de liquidación. No es todavía un pago aplicado al préstamo.</p><button className="button button--primary stage3b__submit" type="button" disabled={busy} onClick={() => void submit()}>{busy ? 'Registrando…' : 'Registrar cobro preliminar'}</button>
      {receipt && <section className="precollection-receipt-ready" aria-labelledby="precollection-receipt-ready-title"><h2 id="precollection-receipt-ready-title">Comprobante disponible</h2><p>El comprobante confirma el monto entregado, quién lo recibió y el saldo actualizado.</p><PrecollectionReceiptActions item={receipt} /></section>}</>}</section></div>
  </section>;
}
