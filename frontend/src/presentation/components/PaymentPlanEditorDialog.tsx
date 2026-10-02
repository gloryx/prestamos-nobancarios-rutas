import type { RefObject } from 'react';
import { reviewPlanDraft, type PlanDraftEntry } from '../helpers/payment-plan';
import { PaymentPlanDraftFields } from './PaymentPlanDraftFields';

export function PaymentPlanEditorDialog({ draft, balance, busy, error, onChange, onAdd, onSave, onClose, dialogRef, dateRef }: {
  draft: PlanDraftEntry[]; balance: string; busy: boolean; error: string;
  onChange: (draft: PlanDraftEntry[]) => void; onAdd: () => void; onSave: () => void; onClose: () => void;
  dialogRef: RefObject<HTMLDivElement | null>; dateRef: RefObject<HTMLInputElement | null>;
}) {
  const review = reviewPlanDraft(balance, draft);
  return <div className="dialog-backdrop"><div className="dialog payment-plan-editor" role="dialog" aria-modal="true" aria-labelledby="payment-plan-editor-title" tabIndex={-1} ref={dialogRef}>
    <h2 id="payment-plan-editor-title">Personalizar plan de pagos</h2>
    <p>Ajusta las fechas y los montos pendientes. Los pagos realizados no se modifican.</p>
    <form onSubmit={(event) => { event.preventDefault(); if (review.canSave && !busy) onSave(); }}>
      <PaymentPlanDraftFields draft={draft} balance={balance} busy={busy} onChange={onChange} onAdd={onAdd} dateRef={dateRef} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer className="payment-plan-editor__footer"><button className="button button--secondary" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="button button--primary" type="submit" disabled={busy || !review.canSave}>{busy ? 'Guardando…' : 'Guardar plan'}</button></footer>
    </form>
  </div></div>;
}
