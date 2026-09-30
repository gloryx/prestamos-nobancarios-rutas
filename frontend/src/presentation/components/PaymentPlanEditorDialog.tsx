import type { RefObject } from 'react';
import { formatDateOnlyForDisplay } from '../../shared/utils/date';
import { formatCRC, moneyFromCents, parseMoneyCents } from '../../shared/utils/money';
import { orderedPlanDraft, reviewPlanDraft, type PlanDraftEntry } from '../helpers/payment-plan';
import { MoneyInput } from './MoneyInput';
import { TableActions } from './TableActions';

export function PaymentPlanEditorDialog({ draft, balance, busy, error, onChange, onAdd, onSave, onClose, dialogRef, dateRef }: {
  draft: PlanDraftEntry[]; balance: string; busy: boolean; error: string;
  onChange: (draft: PlanDraftEntry[]) => void; onAdd: () => void; onSave: () => void; onClose: () => void;
  dialogRef: RefObject<HTMLDivElement | null>; dateRef: RefObject<HTMLInputElement | null>;
}) {
  const review = reviewPlanDraft(balance, draft);
  const update = (key: string, change: Partial<Pick<PlanDraftEntry, 'dueDate' | 'pendingAmount'>>) => onChange(draft.map((entry) => entry.key === key ? { ...entry, ...change } : entry));
  const difference = review.differenceCents;
  return <div className="dialog-backdrop"><div className="dialog payment-plan-editor" role="dialog" aria-modal="true" aria-labelledby="payment-plan-editor-title" tabIndex={-1} ref={dialogRef}>
    <h2 id="payment-plan-editor-title">Personalizar plan de pagos</h2>
    <p>Ajusta las fechas y los montos pendientes. Los pagos realizados no se modifican.</p>
    <form onSubmit={(event) => { event.preventDefault(); if (review.canSave && !busy) onSave(); }}>
      <div className="payment-plan-editor__table-wrap"><table className="catalog-table payment-plan-editor__table">
        <thead><tr><th scope="col">N.º</th><th scope="col">Fecha</th><th scope="col">Monto pendiente</th><th scope="col">Acción</th></tr></thead>
        <tbody>{orderedPlanDraft(draft).map((entry, index) => {
          const validDate = /^\d{4}-\d{2}-\d{2}$/.test(entry.dueDate) && formatDateOnlyForDisplay(entry.dueDate) !== '—';
          const validAmount = (parseMoneyCents(entry.pendingAmount) ?? 0n) > 0n;
          return <tr key={entry.key}><td>{index + 1}</td><td><input ref={index === 0 ? dateRef : undefined} type="date" aria-label={`Fecha de la obligación ${index + 1}`} aria-invalid={!validDate} value={entry.dueDate} disabled={busy} required onChange={(event) => update(entry.key, { dueDate: event.target.value })} /></td>
            <td><MoneyInput aria-label={`Monto de la obligación ${index + 1}`} aria-invalid={!validAmount} value={entry.pendingAmount} disabled={busy} required onChange={(pendingAmount) => update(entry.key, { pendingAmount })} /></td>
            <td><TableActions ariaLabel={`Acciones de la obligación ${index + 1}`} actions={[{ key: 'remove', icon: 'delete', label: 'Eliminar', title: 'Eliminar obligación', ariaLabel: `Eliminar obligación ${index + 1}`, disabled: busy, onClick: () => onChange(draft.filter((item) => item.key !== entry.key)) }]} /></td></tr>;
        })}</tbody>
      </table></div>
      <button className="button button--secondary payment-plan-editor__add" type="button" disabled={busy} onClick={onAdd}>Agregar obligación</button>
      <div className="payment-plan-editor__summary" aria-label="Reconciliación del plan" aria-live="polite">
        <div><span>Saldo financiero pendiente</span><strong>{formatCRC(balance)}</strong></div>
        <div><span>Total distribuido</span><strong>{formatCRC(moneyFromCents(review.distributedCents))}</strong></div>
        <div><span>Diferencia</span><strong>{difference === null ? '—' : `${difference < 0n ? '-' : ''}${formatCRC(moneyFromCents(difference < 0n ? -difference : difference))}`}</strong></div>
      </div>
      {!review.canSave && <p className="payment-plan-editor__hint">Incluye al menos una obligación con fecha válida y monto mayor que cero. El total debe coincidir con el saldo pendiente.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer className="payment-plan-editor__footer"><button className="button button--secondary" type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="button button--primary" type="submit" disabled={busy || !review.canSave}>{busy ? 'Guardando…' : 'Guardar plan'}</button></footer>
    </form>
  </div></div>;
}
