import type { RefObject } from 'react';
import { formatDateOnlyForDisplay } from '../../shared/utils/date';
import { formatCRC, moneyFromCents, parseMoneyCents } from '../../shared/utils/money';
import { orderedPlanDraft, reviewPlanDraft, type PlanDraftEntry } from '../helpers/payment-plan';
import { MoneyInput } from './MoneyInput';
import { TableActions } from './TableActions';

export function PaymentPlanDraftFields({ draft, balance, busy, onChange, onAdd, dateRef, allowEmpty = false, minDate, balanceLabel = 'Saldo financiero pendiente' }: {
  draft: PlanDraftEntry[]; balance: string; busy: boolean; onChange: (draft: PlanDraftEntry[]) => void; onAdd: () => void;
  dateRef: RefObject<HTMLInputElement | null>; allowEmpty?: boolean; minDate?: string; balanceLabel?: string;
}) {
  const review = reviewPlanDraft(balance, draft, { allowEmpty, minDate });
  const update = (key: string, change: Partial<Pick<PlanDraftEntry, 'dueDate' | 'pendingAmount'>>) => onChange(draft.map((entry) => entry.key === key ? { ...entry, ...change } : entry));
  const difference = review.differenceCents;
  return <>
    <div className="payment-plan-editor__table-wrap"><table className="catalog-table payment-plan-editor__table">
      <thead><tr><th scope="col">N.º</th><th scope="col">Fecha</th><th scope="col">Monto pendiente</th><th scope="col">Acción</th></tr></thead>
      <tbody>{orderedPlanDraft(draft).map((entry, index) => {
        const validDate = /^\d{4}-\d{2}-\d{2}$/.test(entry.dueDate) && formatDateOnlyForDisplay(entry.dueDate) !== '—' && (!minDate || entry.dueDate >= minDate);
        const validAmount = (parseMoneyCents(entry.pendingAmount) ?? 0n) > 0n;
        return <tr key={entry.key}><td>{index + 1}</td><td><input ref={index === 0 ? dateRef : undefined} type="date" min={minDate} aria-label={`Fecha de la obligación ${index + 1}`} aria-invalid={!validDate} value={entry.dueDate} disabled={busy} required onChange={(event) => update(entry.key, { dueDate: event.target.value })} /></td>
          <td><MoneyInput aria-label={`Monto de la obligación ${index + 1}`} aria-invalid={!validAmount} value={entry.pendingAmount} disabled={busy} required onChange={(pendingAmount) => update(entry.key, { pendingAmount })} /></td>
          <td><TableActions ariaLabel={`Acciones de la obligación ${index + 1}`} actions={[{ key: 'remove', icon: 'delete', label: 'Eliminar', title: 'Eliminar obligación', ariaLabel: `Eliminar obligación ${index + 1}`, disabled: busy, onClick: () => onChange(draft.filter((item) => item.key !== entry.key)) }]} /></td></tr>;
      })}</tbody>
    </table></div>
    <button className="button button--secondary payment-plan-editor__add" type="button" disabled={busy} onClick={onAdd}>Agregar obligación</button>
    <div className="payment-plan-editor__summary" aria-label="Reconciliación del plan" aria-live="polite">
      <div><span>{balanceLabel}</span><strong>{formatCRC(balance)}</strong></div>
      <div><span>Total distribuido</span><strong>{formatCRC(moneyFromCents(review.distributedCents))}</strong></div>
      <div><span>Diferencia</span><strong>{difference === null ? '—' : `${difference < 0n ? '-' : ''}${formatCRC(moneyFromCents(difference < 0n ? -difference : difference))}`}</strong></div>
    </div>
    {!review.canSave && <p className="payment-plan-editor__hint">{allowEmpty && balance === '0.00' ? 'Para un saldo de cero, elimina todas las obligaciones.' : 'Incluye al menos una obligación con fecha válida y monto mayor que cero. El total debe coincidir con el saldo pendiente.'}</p>}
  </>;
}
