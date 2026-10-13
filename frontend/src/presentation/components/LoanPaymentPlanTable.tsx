import type { ReactElement } from "react";
import type { LoanPlanEntry } from "../../domain/entities/loan";
import { formatCRC, moneyFromCents, parseMoneyCents } from "../../shared/utils/money";
import { formatDateOnlyForDisplay } from "../../shared/utils/date";
import { MoneyInput } from "./MoneyInput";
import { getLoanPlanCondition } from "../helpers/loan";
import type { PaymentApplication } from "../../domain/entities/payment";
import { hasPaidPlanEvidence } from "../../domain/payment-plan-numbering";

type LoanPaymentPlanTableProps = {
  plan: Array<LoanPlanEntry & { id?: string }>;
  total: string;
  editable?: boolean;
  onChange?: (plan: LoanPlanEntry[]) => void;
  onAddRow?: () => void;
  showCondition?: boolean;
  numberLabel?: string;
  amountLabel?: string;
  paymentApplications?: PaymentApplication[];
  hideReprogrammed?: boolean;
};

export function LoanPaymentPlanTable({
  plan,
  total,
  editable = false,
  onChange,
  onAddRow,
  showCondition = false,
  numberLabel,
  amountLabel,
  paymentApplications = [],
  hideReprogrammed = false,
}: LoanPaymentPlanTableProps): ReactElement {
  const distributed = plan.reduce(
    (sum, entry) => sum + (parseMoneyCents(entry.pendingAmount) ?? 0n),
    0n,
  );
  const totalCents = parseMoneyCents(total) ?? 0n;
  const difference = totalCents - distributed;
  const rows = plan.map((entry, originalIndex) => {
    const hasVerifiedPayment = 'id' in entry && typeof entry.id === 'string'
      && hasPaidPlanEvidence(entry.id, paymentApplications);
    return { entry, originalIndex, condition: getLoanPlanCondition(entry, hasVerifiedPayment) };
  }).filter(({ condition }) => !hideReprogrammed || condition !== 'REPROGRAMADA');
  if (!editable) rows.sort((left, right) => left.entry.dueDate.localeCompare(right.entry.dueDate)
    || left.entry.sequence - right.entry.sequence
    || ('id' in left.entry && 'id' in right.entry ? String(left.entry.id).localeCompare(String(right.entry.id)) : 0));
  const updateEntry = (index: number, update: Partial<LoanPlanEntry>) => {
    onChange?.(
      plan.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, ...update } : entry,
      ),
    );
  };

  return (
    <section
      className={`loan-confirmation__plan${editable ? " loan-confirmation__plan--editable" : ""}${showCondition ? " loan-confirmation__plan--with-condition" : ""}`}
      aria-labelledby="loan-payment-plan-title"
    >
      <div className="loan-confirmation__plan-heading">
        <h3 id="loan-payment-plan-title">PLAN DE PAGOS</h3>
        <span>{rows.length} Cuotas programadas</span>
      </div>
      <div className="loan-confirmation__table-wrap">
        <table className="loan-confirmation__table">
          <thead>
            <tr>
              <th>{numberLabel ?? (showCondition ? "Cuota" : "N.º")}</th>
              <th>{showCondition ? "Vencimiento" : "Fecha"}</th>
              <th>{amountLabel ?? (showCondition ? "Pendiente" : "Cuota")}</th>
              {showCondition && <th>Condición</th>}
              {editable && <th>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ entry, originalIndex, condition }, index) => {
              const displaySequence = index + 1;
              return (
              <tr key={'id' in entry && entry.id ? entry.id : `${entry.sequence}-${originalIndex}`}>
                <td>{displaySequence}</td>
                <td>
                  {editable ? (
                    <input
                      type="date"
                      value={entry.dueDate}
                      aria-label={`Fecha de la cuota ${displaySequence}`}
                      onChange={(event) => updateEntry(originalIndex, { dueDate: event.target.value })}
                    />
                  ) : (
                    formatDateOnlyForDisplay(entry.dueDate)
                  )}
                </td>
                <td>
                  {editable ? (
                    <MoneyInput
                      value={entry.pendingAmount}
                      aria-label={`Monto de la cuota ${displaySequence}`}
                      onChange={(pendingAmount) => updateEntry(originalIndex, { pendingAmount })}
                    />
                  ) : (
                    formatCRC(entry.pendingAmount)
                  )}
                </td>
                {showCondition && (
                  <td>
                    <span className={`loan-plan-condition loan-plan-condition--${condition.toLowerCase()}`}>
                      {condition}
                    </span>
                  </td>
                )}
                {editable && (
                  <td>
                    <button
                      className="button button--secondary loan-payment-plan__remove"
                      type="button"
                      onClick={() =>
                        onChange?.(
                          plan
                            .filter((_, entryIndex) => entryIndex !== originalIndex)
                            .map((item, itemIndex) => ({ ...item, sequence: itemIndex + 1 })),
                        )
                      }
                    >
                      Eliminar
                    </button>
                  </td>
                )}
              </tr>
            ); })}
          </tbody>
        </table>
      </div>
      <div
        className={`loan-confirmation__reconciliation${difference !== 0n ? " loan-confirmation__reconciliation--invalid" : ""}`}
        aria-label="Reconciliación del plan de pagos"
      >
        <div>
          <span>Total a pagar</span>
          <strong>{formatCRC(total)}</strong>
        </div>
        <div>
          <span>Total distribuido</span>
          <strong>{formatCRC(moneyFromCents(distributed))}</strong>
        </div>
        <div aria-live="polite">
          <span>Diferencia</span>
          <strong>
            {formatCRC(moneyFromCents(difference))}
            {difference !== 0n && <span className="loan-confirmation__reconciliation-status"> — Revisar</span>}
          </strong>
        </div>
      </div>
      {editable && onAddRow && (
        <button className="button button--secondary loan-payment-plan__add" type="button" onClick={onAddRow}>
          + Agregar cuota
        </button>
      )}
    </section>
  );
}
