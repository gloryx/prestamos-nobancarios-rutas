import { useEffect, useRef, type ReactElement } from 'react';
import type { LoanAttempt } from '../../application/use-cases/loan-management-controller';
import type { OverdueLoan, UncollectibleLoan } from '../../domain/entities/loan';
import { formatDateOnlyForDisplay } from '../../shared/utils/date';
import { formatCRCAggregate } from '../../shared/utils/money';
import { loanManagementMessage } from '../helpers/loan-management-message';

export function LoanManagementStatusDialog({ attempt, row, onReason, onSubmit, onClose }: {
  attempt: LoanAttempt; row: OverdueLoan | UncollectibleLoan | null;
  onReason: (value: string) => void; onSubmit: () => void; onClose: () => void;
}): ReactElement {
  const dialogRef = useRef<HTMLDivElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const marking = attempt.operation === 'MARK';
  useEffect(() => { (attempt.submitting ? dialogRef.current : reasonRef.current)?.focus(); }, [attempt.submitting]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (!attempt.submitting) onClose(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('textarea:not([disabled]), button:not([disabled])'));
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (!first || !last) { event.preventDefault(); dialogRef.current.focus(); return; }
      if (!dialogRef.current.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [attempt.submitting, onClose]);
  const context = row?.loanId === attempt.selectedLoan.loanId ? row : null;
  return <div className="dialog-backdrop"><div className="dialog payment-capture-dialog loan-management__dialog" role="dialog" aria-modal="true"
    aria-labelledby="loan-management-dialog-title" aria-describedby="loan-management-dialog-description" aria-busy={attempt.submitting} tabIndex={-1} ref={dialogRef}>
    <header className="payment-capture-dialog__header"><h2 id="loan-management-dialog-title">{marking ? 'Marcar' : 'Reactivar'} préstamo #{attempt.selectedLoan.loanNumber}{marking ? ' como incobrable' : ''}</h2></header>
    <div className="payment-capture-dialog__context"><strong>{attempt.selectedLoan.customer.fullName}</strong>
      {attempt.selectedLoan.customer.identification && <span>Identificación: {attempt.selectedLoan.customer.identification}</span>}
      {context && <span>Saldo pendiente: {formatCRCAggregate(context.financialBalance)}</span>}
      {context?.status === 'ACTIVE' && <><span>Primer vencimiento: {formatDateOnlyForDisplay(context.firstOverdueDueDate)}</span>
        <span>Cuota vencida: {formatCRCAggregate(context.firstOverdueAmount)}</span></>}
      {context?.status === 'UNCOLLECTIBLE' && <span>Incobrable desde: {formatDateOnlyForDisplay(context.uncollectibleBusinessDate)}</span>}
    </div>
    <p id="loan-management-dialog-description">{marking
      ? 'Marcar como incobrable no condona la deuda ni modifica el saldo pendiente.'
      : 'El préstamo volverá a estar activo; el plan de pagos no cambiará automáticamente.'}</p>
    <form onSubmit={(event) => { event.preventDefault(); if (!attempt.submitting && attempt.reasonDraft.trim()) onSubmit(); }}>
      <label htmlFor="loan-management-reason">Motivo<textarea id="loan-management-reason" ref={reasonRef} value={attempt.reasonDraft} required disabled={attempt.submitting}
        onChange={(event) => onReason(event.target.value)} /></label>
      {attempt.error && <p className="form-error" role="alert">{loanManagementMessage(attempt.error)}</p>}
      <footer className="payment-capture-dialog__footer"><button className="button button--secondary" type="button" disabled={attempt.submitting} onClick={onClose}>Cancelar</button>
        <button className="button button--primary" type="submit" disabled={attempt.submitting || !attempt.reasonDraft.trim()}>
          {attempt.submitting ? 'Guardando…' : marking ? 'Marcar como incobrable' : 'Reactivar préstamo'}</button></footer>
    </form>
  </div></div>;
}
