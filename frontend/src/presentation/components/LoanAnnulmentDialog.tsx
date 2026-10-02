import { useEffect, useRef, type ReactElement } from 'react';
import type { AnnulmentAttempt } from '../../application/use-cases/loan-annulment-controller';
import { formatDateOnlyForDisplay } from '../../shared/utils/date';
import { formatCRCAggregate } from '../../shared/utils/money';

export function LoanAnnulmentDialog({ attempt, onReason, onResolution, onSubmit, onClose }: {
  attempt: AnnulmentAttempt; onReason: (value: string) => void;
  onResolution: (value: 'NOT_DELIVERED' | 'RETURNED_IN_FULL') => void;
  onSubmit: () => void; onClose: () => void;
}): ReactElement {
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstRadioRef = useRef<HTMLInputElement>(null);
  useEffect(() => { (attempt.submitting ? dialogRef.current : firstRadioRef.current)?.focus(); }, [attempt.submitting]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (!attempt.submitting) onClose(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('input:not([disabled]), textarea:not([disabled]), button:not([disabled])'));
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (!first || !last) { event.preventDefault(); dialogRef.current.focus(); return; }
      if (!dialogRef.current.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [attempt.submitting, onClose]);
  const { loan } = attempt;
  const reason = attempt.reasonDraft.trim();
  const valid = Boolean(attempt.resolution && reason && reason.length <= 500);
  return <div className="dialog-backdrop"><div className="dialog payment-capture-dialog loan-management__dialog" role="dialog" aria-modal="true"
    aria-labelledby="loan-annulment-dialog-title" aria-describedby="loan-annulment-dialog-warning" aria-busy={attempt.submitting} tabIndex={-1} ref={dialogRef}>
    <header className="payment-capture-dialog__header"><h2 id="loan-annulment-dialog-title">Anular préstamo #{loan.loanNumber}</h2></header>
    <div className="payment-capture-dialog__context"><strong>Cliente: {loan.customer.fullName}</strong>
      <span>Identificación: {loan.customer.identification}</span><span>Capital: {formatCRCAggregate(loan.principal)}</span>
      <span>Interés: {formatCRCAggregate(loan.interestAmount)}</span><span>Total contractual: {formatCRCAggregate(loan.totalAmount)}</span>
      <span>Fecha de inicio: {formatDateOnlyForDisplay(loan.startDate)}</span></div>
    <p id="loan-annulment-dialog-warning" className="loan-annulment__warning">Esta operación es definitiva. El préstamo será anulado y no podrá reactivarse.</p>
    <p>Confirmá únicamente si el dinero no fue entregado o fue devuelto íntegramente.</p>
    <form onSubmit={(event) => { event.preventDefault(); if (valid && !attempt.submitting) onSubmit(); }}>
      <fieldset className="loan-annulment__resolution" disabled={attempt.submitting}>
        <legend>Situación del desembolso</legend>
        <label><input ref={firstRadioRef} type="radio" name="disbursement-resolution" value="NOT_DELIVERED"
          checked={attempt.resolution === 'NOT_DELIVERED'} onChange={() => onResolution('NOT_DELIVERED')} />El dinero no fue entregado al cliente</label>
        <label><input type="radio" name="disbursement-resolution" value="RETURNED_IN_FULL"
          checked={attempt.resolution === 'RETURNED_IN_FULL'} onChange={() => onResolution('RETURNED_IN_FULL')} />El dinero fue devuelto íntegramente</label>
      </fieldset>
      <label htmlFor="loan-annulment-reason">Motivo<textarea id="loan-annulment-reason" value={attempt.reasonDraft} maxLength={500}
        required disabled={attempt.submitting} onChange={(event) => onReason(event.target.value)} /></label>
      <span className="loan-annulment__counter">{attempt.reasonDraft.length} / 500</span>
      {attempt.error && <p className="form-error" role="alert">{attempt.error}</p>}
      <footer className="payment-capture-dialog__footer"><button className="button button--secondary" type="button"
        disabled={attempt.submitting} onClick={onClose}>Cancelar</button>
        <button className="button button--primary" type="submit" disabled={!valid || attempt.submitting}>
          {attempt.submitting ? 'Anulando…' : 'Anular préstamo'}</button></footer>
    </form>
  </div></div>;
}
