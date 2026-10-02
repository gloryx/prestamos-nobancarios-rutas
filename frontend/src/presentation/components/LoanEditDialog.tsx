import { useCallback, useEffect, useRef, useState } from 'react';
import type { LoanEditBody, LoanEditContext } from '../../domain/entities/loan';
import { HttpApiError } from '../../infrastructure/api/api-client';
import type { loanApi } from '../../infrastructure/api/loan.api';
import { formatDateOnlyForDisplay } from '../../shared/utils/date';
import { formatCRCAggregate } from '../../shared/utils/money';
import { draftFromLoan, loanEditAttempt, reviewLoanEdit, type LoanEditDraft } from '../helpers/loan-edit';
import { localDateOnly, reviewPlanDraft, type PlanDraftEntry } from '../helpers/payment-plan';
import { useToast } from './ToastContext';
import { MoneyInput } from './MoneyInput';
import { PaymentPlanDraftFields } from './PaymentPlanDraftFields';
import './loan-edit.css';

type EditApi = Pick<typeof loanApi, 'editContext' | 'edit'>;
const message = (error: unknown) => error instanceof Error ? error.message : 'No fue posible completar la solicitud.';

export function LoanEditDialog({ loanId, api, onSaved, onUnavailable, onClose }: {
  loanId: string; api: EditApi; onSaved: () => Promise<void>; onUnavailable: () => Promise<void>; onClose: () => void;
}) {
  const { toast } = useToast();
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLSelectElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const locked = useRef(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const [context, setContext] = useState<LoanEditContext | null>(null);
  const [draft, setDraft] = useState<LoanEditDraft | null>(null);
  const [plan, setPlan] = useState<PlanDraftEntry[]>([]);
  const [step, setStep] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const token = ++request.current;
    setLoading(true); setError('');
    try {
      const fresh = await api.editContext(loanId);
      if (token !== request.current) return;
      if (fresh.loan.status !== 'ACTIVE') {
        setBlocked(true); setError('Solo se pueden editar préstamos activos.');
        void onUnavailable();
        return;
      }
      setContext(fresh); setDraft(draftFromLoan(fresh));
      setPlan(fresh.baseline.plan.map((entry) => ({ ...entry, key: entry.id })));
      attempt.current = null; setStep(1); setBlocked(false); setConflict(false);
    } catch (cause) {
      if (token !== request.current) return;
      if (cause instanceof HttpApiError && cause.status === 404) { void onUnavailable(); onClose(); return; }
      if (cause instanceof HttpApiError && cause.status === 409) {
        setBlocked(true); void onUnavailable();
        setError(`No se puede editar este préstamo. ${cause.message}`);
      } else setError(message(cause));
    } finally { if (token === request.current) setLoading(false); }
  }, [loanId, api, onUnavailable, onClose]);

  useEffect(() => { void load(); return () => { ++request.current; }; }, [load]);
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialogRef.current?.focus();
    return () => {
      queueMicrotask(() => {
        if (dialog?.isConnected) return;
        const label = trigger?.getAttribute('aria-label');
        const replacement = label ? Array.from(document.querySelectorAll<HTMLElement>('button[aria-label]')).find((button) => button.getAttribute('aria-label') === label) : null;
        (trigger?.isConnected ? trigger : replacement ?? document.querySelector<HTMLElement>('#loan-list-title, .loan-detail__header h1'))?.focus();
      });
    };
  }, []);
  useEffect(() => {
    if (busy) dialogRef.current?.focus();
    else if (step === 2) (dateRef.current ?? dialogRef.current)?.focus();
    else if (context) firstRef.current?.focus();
  }, [step, busy, context]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (!locked.current && !busy) onClose(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const controls = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'));
      const first = controls[0]; const last = controls[controls.length - 1];
      if (!first || !last) { event.preventDefault(); dialogRef.current.focus(); }
      else if (!dialogRef.current.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [busy, onClose]);

  const change = (part: Partial<LoanEditDraft>) => {
    if (!draft || locked.current || saved) return;
    attempt.current = null; setError(''); setDraft({ ...draft, ...part });
  };
  const changePlan = (entries: PlanDraftEntry[]) => {
    if (locked.current || saved) return;
    attempt.current = null; setError(''); setPlan(entries);
  };
  const refreshSaved = async () => {
    setBusy(true); setError('');
    try {
      await Promise.all([api.editContext(loanId), onSaved()]);
      toast.success('Préstamo actualizado correctamente.'); onClose();
    } catch (cause) { setError(`El préstamo se guardó, pero no se pudieron actualizar los datos. ${message(cause)}`); }
    finally { setBusy(false); }
  };
  const submit = async () => {
    if (locked.current || busy || saved || conflict || blocked || !context || !draft) return;
    const review = reviewLoanEdit(context, draft);
    if (!review.valid || !Object.keys(review.changes).length) return;
    if (review.interestChanged && step === 1) { setStep(2); setError(''); return; }
    const planReview = review.interestChanged ? reviewPlanDraft(review.newBalance!, plan, { allowEmpty: true, minDate: context.loan.startDate }) : null;
    if (planReview && !planReview.canSave) return;
    const body: Omit<LoanEditBody, 'idempotencyKey'> = { baseline: context.baseline, changes: review.changes,
      ...(planReview ? { plan: planReview.entries } : {}) };
    const next = loanEditAttempt(attempt.current, loanId, body);
    attempt.current = next;
    locked.current = true; setBusy(true); setError('');
    try {
      await api.edit(loanId, { ...body, idempotencyKey: next.key });
      setSaved(true);
      await refreshSaved();
    } catch (cause) {
      if (cause instanceof HttpApiError && cause.status === 404) { void onUnavailable(); onClose(); }
      else if (cause instanceof HttpApiError && cause.status === 409) {
        setConflict(true); setError(`El préstamo cambió o no puede editarse. Actualiza los datos antes de continuar. ${cause.message}`);
      } else setError(message(cause));
    } finally { locked.current = false; setBusy(false); }
  };
  const review = context && draft ? reviewLoanEdit(context, draft) : null;
  const planReview = review?.interestChanged && review.newBalance ? reviewPlanDraft(review.newBalance, plan, { allowEmpty: true, minDate: context!.loan.startDate }) : null;
  const disabled = busy || saved || conflict || blocked || loading;
  const selectOptions = (options: LoanEditContext['paymentFrequencyOptions'], selected: string) =>
    options.filter((option) => option.active || option.id === selected).map((option) =>
      <option key={option.id} value={option.id}>{option.name}{option.active ? '' : ' (inactivo)'}</option>);

  return <div className="dialog-backdrop"><div className="dialog loan-edit payment-plan-editor" role="dialog" aria-modal="true" aria-labelledby="loan-edit-title" aria-busy={busy} tabIndex={-1} ref={dialogRef}>
    <h2 id="loan-edit-title">Editar préstamo{context ? ` #${context.loan.loanNumber}` : ''}</h2>
    {loading && <p role="status">Cargando datos del préstamo…</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {saved ? <footer className="payment-plan-editor__footer"><button className="button button--secondary" type="button" disabled={busy} onClick={onClose}>Cerrar</button><button className="button button--primary" type="button" disabled={busy} onClick={() => { void refreshSaved(); }}>Reintentar actualización</button></footer>
      : blocked ? <footer className="payment-plan-editor__footer"><button className="button button--secondary" type="button" onClick={onClose}>Cerrar</button></footer>
      : context && draft && !loading ? <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <p>{context.loan.customer.fullName} · {context.loan.customer.identification}</p>
        {conflict && <button className="button button--secondary" type="button" disabled={busy} onClick={() => { void load(); }}>Actualizar datos</button>}
        {step === 1 ? <>
          <dl className="loan-edit__facts">
            <div><dt>Capital (solo lectura)</dt><dd>{formatCRCAggregate(context.loan.principal)}</dd></div>
            <div><dt>Inicio (solo lectura)</dt><dd>{formatDateOnlyForDisplay(context.loan.startDate)}</dd></div>
            <div><dt>Total actual (solo lectura)</dt><dd>{formatCRCAggregate(context.loan.totalAmount)}</dd></div>
            <div><dt>Saldo financiero actual (solo lectura)</dt><dd>{formatCRCAggregate(context.baseline.financialBalance)}</dd></div>
          </dl>
          <div className="loan-edit__fields">
            <label>Interés<MoneyInput value={draft.interestAmount} disabled={disabled} required onChange={(interestAmount) => change({ interestAmount })} /></label>
            <label>Periodicidad<select ref={firstRef} value={draft.paymentFrequencyId} disabled={disabled} onChange={(event) => change({ paymentFrequencyId: event.target.value })}>{selectOptions(context.paymentFrequencyOptions, context.baseline.paymentFrequencyId)}</select></label>
            <label>Forma de pago preferida<select value={draft.preferredPaymentMethodId} disabled={disabled} onChange={(event) => change({ preferredPaymentMethodId: event.target.value })}>{selectOptions(context.preferredPaymentMethodOptions, context.baseline.preferredPaymentMethodId)}</select></label>
            <label>Observaciones<textarea value={draft.observations} disabled={disabled} onChange={(event) => change({ observations: event.target.value })} /></label>
          </div>
          <dl className="loan-edit__facts" aria-label="Vista previa de importes"><div><dt>Nuevo total (vista previa)</dt><dd>{review?.valid && review.newTotal ? formatCRCAggregate(review.newTotal) : '—'}</dd></div><div><dt>Nuevo saldo (vista previa)</dt><dd>{review?.valid && review.newBalance ? formatCRCAggregate(review.newBalance) : '—'}</dd></div></dl>
          <p>Los importes son orientativos; el servidor valida el saldo y el plan al guardar.</p>
        </> : <div className="loan-edit__plan"><p>Paso 2: ajusta manualmente las obligaciones al nuevo saldo. Los pagos realizados no se modifican.</p>
          <PaymentPlanDraftFields draft={plan} balance={review?.newBalance ?? ''} busy={disabled} minDate={context.loan.startDate} allowEmpty balanceLabel="Nuevo saldo a distribuir" dateRef={dateRef}
            onChange={changePlan} onAdd={() => changePlan([...plan, { key: crypto.randomUUID(), id: null, dueDate: localDateOnly(), pendingAmount: '' }])} />
        </div>}
        <footer className="payment-plan-editor__footer"><button className="button button--secondary" type="button" disabled={busy} onClick={onClose}>Cancelar</button>
          {step === 2 && <button className="button button--secondary" type="button" disabled={busy} onClick={() => setStep(1)}>Anterior</button>}
          <button className="button button--primary" type="submit" disabled={disabled || !review?.valid || !Object.keys(review.changes).length || (step === 2 && !planReview?.canSave)}>{busy ? 'Guardando…' : step === 1 && review?.interestChanged ? 'Continuar' : 'Guardar cambios'}</button>
        </footer>
      </form> : !loading && <footer className="payment-plan-editor__footer"><button className="button button--secondary" type="button" onClick={onClose}>Cerrar</button><button className="button button--primary" type="button" onClick={() => { void load(); }}>Reintentar carga</button></footer>}
  </div></div>;
}
