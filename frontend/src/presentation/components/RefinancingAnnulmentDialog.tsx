import { useEffect, useRef, type ReactElement } from 'react';
import type { RefinancingAnnulmentAttempt } from '../../application/use-cases/refinancing-annulment-controller';
import type { RefinancingAnnulmentPaymentMethod, RefinancingAnnulmentType } from '../../domain/entities/loan-refinancing';
import { refinancingAnnulmentReasonMessage } from '../../application/errors/refinancing-annulment-error';
import { formatDateOnlyForDisplay } from '../../shared/utils/date';
import { formatCRCAggregate } from '../../shared/utils/money';

export function RefinancingAnnulmentDialog({ attempt, methods, onType, onReason, onEffectiveDate,
  onValidateDate, onRefundMethod, onResolutionConfirmed, onSubmit, onClose }: {
  attempt: RefinancingAnnulmentAttempt;
  methods: RefinancingAnnulmentPaymentMethod[];
  onType(value: RefinancingAnnulmentType): void;
  onReason(value: string): void;
  onEffectiveDate(value: string): void;
  onValidateDate(): void;
  onRefundMethod(value: string): void;
  onResolutionConfirmed(value: boolean): void;
  onSubmit(): void;
  onClose(): void;
}): ReactElement {
  const dialog = useRef<HTMLDivElement>(null), first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const target = attempt.submitting ? dialog.current : first.current?.disabled
      ? dialog.current?.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])')
      : first.current;
    target?.focus();
  }, [attempt.submitting]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (!attempt.submitting) onClose(); return; }
      if (event.key !== 'Tab' || !dialog.current) return;
      const controls = Array.from(dialog.current.querySelectorAll<HTMLElement>('input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])'));
      if (!controls.length) { event.preventDefault(); dialog.current.focus(); return; }
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
    };
    document.addEventListener('keydown', keydown); return () => document.removeEventListener('keydown', keydown);
  }, [attempt.submitting, onClose]);
  const { candidate } = attempt, cash = attempt.type === 'CASH_REFUND';
  const positiveMoney = Number(candidate.newMoneyDisbursed) > 0;
  const selectedEligibility = attempt.type ? attempt.eligibility.types[attempt.type] : null;
  const dateValidated = cash && attempt.validatedEffectiveDate === attempt.effectiveDate && selectedEligibility?.eligible;
  const valid = Boolean(attempt.type && selectedEligibility?.eligible && attempt.reason.trim().length >= 8 &&
    attempt.reason.trim().length <= 500 && (!cash || dateValidated) &&
    (!positiveMoney || attempt.resolutionConfirmed && (!cash || attempt.refundPaymentMethodId)));
  return <div className="dialog-backdrop"><div ref={dialog} className="dialog payment-capture-dialog loan-management__dialog"
    role="dialog" aria-modal="true" aria-labelledby="refinancing-annulment-title" aria-busy={attempt.submitting} tabIndex={-1}>
    <header className="payment-capture-dialog__header"><h2 id="refinancing-annulment-title">Anular refinanciamiento</h2></header>
    <div className="payment-capture-dialog__context"><strong>{candidate.customer.fullName}</strong>
      <span>{candidate.customer.identification}</span><span>Origen: #{candidate.originLoanNumber}</span>
      <span>Sucesor: #{candidate.successorLoanNumber}</span>
      <span>Fecha original: {formatDateOnlyForDisplay(candidate.refinancingDate)}</span>
      <span>Dinero nuevo: {formatCRCAggregate(candidate.newMoneyDisbursed)}</span></div>
    <p className="loan-annulment__warning">Esta operación es definitiva y restaura el préstamo origen.</p>
    <form onSubmit={(event) => { event.preventDefault(); if (valid && !attempt.submitting) onSubmit(); }}>
      <fieldset className="loan-annulment__resolution" disabled={attempt.submitting}>
        <legend>Modalidad</legend>
        {(['DATA_CORRECTION', 'CASH_REFUND'] as const).map((type, index) => {
          const eligibility = attempt.eligibility.types[type];
          const descriptionId = `refinancing-annulment-${type.toLowerCase()}-blockers`;
          return <div key={type}><label>
            <input ref={index === 0 ? first : undefined} type="radio" name="refinancing-annulment-type" value={type}
              checked={attempt.type === type} disabled={!eligibility.eligible}
              aria-describedby={!eligibility.eligible ? descriptionId : undefined}
              onChange={() => onType(type)} />{type === 'DATA_CORRECTION' ? 'Corrección de datos' : 'Devolución de dinero'}
          </label>{!eligibility.eligible && <ul id={descriptionId} className="form-error">{eligibility.reasons.map((item) =>
            <li key={item.code}>{refinancingAnnulmentReasonMessage(item.code)}</li>)}</ul>}</div>;
        })}
      </fieldset>
      {cash && <div className="refinancing-annulment__date-validation"><label htmlFor="refinancing-annulment-effective-date">
        Fecha efectiva<input id="refinancing-annulment-effective-date" type="date" required value={attempt.effectiveDate}
          disabled={attempt.submitting || attempt.validating} onChange={(event) => onEffectiveDate(event.target.value)} /></label>
        <button className="button button--secondary" type="button" disabled={!attempt.effectiveDate || attempt.validating || attempt.submitting}
          onClick={onValidateDate}>{attempt.validating ? 'Validando…' : 'Validar fecha'}</button>
        {dateValidated && <span className="success-message" role="status">Fecha validada</span>}</div>}
      {cash && positiveMoney && <><label htmlFor="refinancing-annulment-method">Método de recepción
        <select id="refinancing-annulment-method" required value={attempt.refundPaymentMethodId} disabled={attempt.submitting}
          onChange={(event) => onRefundMethod(event.target.value)}><option value="">Seleccionar</option>
          {methods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}</select></label>
        </>}
      {attempt.type && positiveMoney && <label className="refinancing-annulment__confirmation"><input type="checkbox"
        checked={attempt.resolutionConfirmed} disabled={attempt.submitting}
        onChange={(event) => onResolutionConfirmed(event.target.checked)} />{cash
          ? 'Confirmo que el dinero nuevo fue devuelto íntegramente y recibido por el método indicado.'
          : 'Confirmo que el dinero nuevo no fue entregado y que no se recibió una devolución física.'}</label>}
      <label htmlFor="refinancing-annulment-reason">Motivo<textarea id="refinancing-annulment-reason" required minLength={8}
        maxLength={500} value={attempt.reason} disabled={attempt.submitting} onChange={(event) => onReason(event.target.value)} /></label>
      <span className="loan-annulment__counter">{attempt.reason.length} / 500</span>
      {attempt.error && <p className="form-error" role="alert">{attempt.error}</p>}
      <footer className="payment-capture-dialog__footer"><button className="button button--secondary" type="button"
        disabled={attempt.submitting} onClick={onClose}>Cancelar</button><button className="button button--primary" type="submit"
        disabled={!valid || attempt.submitting}>{attempt.submitting ? 'Anulando…' : 'Anular refinanciamiento'}</button></footer>
    </form>
  </div></div>;
}
