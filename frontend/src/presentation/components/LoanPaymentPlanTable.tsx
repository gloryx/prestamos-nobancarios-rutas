import type { ReactElement } from "react";
import type { LoanPlanEntry } from "../../domain/entities/loan";
import { formatCRC, moneyFromCents, parseMoneyCents } from "../../shared/utils/money";
import { formatDateOnlyForDisplay } from "../../shared/utils/date";
import { MoneyInput } from "./MoneyInput";
import { getLoanPlanCondition } from "../helpers/loan";

type LoanPaymentPlanTableProps = {
  plan: LoanPlanEntry[];
  total: string;
  editable?: boolean;
  onChange?: (plan: LoanPlanEntry[]) => void;
  onAddRow?: () => void;
  showCondition?: boolean;
  numberLabel?: string;
  amountLabel?: string;
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
}: LoanPaymentPlanTableProps): ReactElement {
  const distributed = plan.reduce(
    (sum, entry) => sum + (parseMoneyCents(entry.pendingAmount) ?? 0n),
    0n,
  );
  const totalCents = parseMoneyCents(total) ?? 0n;
  const difference = totalCents - distributed;
  const absoluteDifference = difference < 0n ? -difference : difference;
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
        <span>{plan.length} Cuotas programadas</span>
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
            {plan.map((entry, index) => (
              <tr key={`${entry.sequence}-${index}`}>
                <td>{entry.sequence}</td>
                <td>
                  {editable ? (
                    <input
                      type="date"
                      value={entry.dueDate}
                      aria-label={`Fecha de la cuota ${entry.sequence}`}
                      onChange={(event) => updateEntry(index, { dueDate: event.target.value })}
                    />
                  ) : (
                    formatDateOnlyForDisplay(entry.dueDate)
                  )}
                </td>
                <td>
                  {editable ? (
                    <MoneyInput
                      value={entry.pendingAmount}
                      aria-label={`Monto de la cuota ${entry.sequence}`}
                      onChange={(pendingAmount) => updateEntry(index, { pendingAmount })}
                    />
                  ) : (
                    formatCRC(entry.pendingAmount)
                  )}
                </td>
                {showCondition && (
                  <td>
                    <span className={`loan-plan-condition loan-plan-condition--${getLoanPlanCondition(entry).toLowerCase()}`}>
                      {getLoanPlanCondition(entry)}
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
                            .filter((_, entryIndex) => entryIndex !== index)
                            .map((item, itemIndex) => ({ ...item, sequence: itemIndex + 1 })),
                        )
                      }
                    >
                      Eliminar
                    </button>
                  </td>
                )}
              </tr>
            ))}
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
            {formatCRC(moneyFromCents(absoluteDifference))}
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
