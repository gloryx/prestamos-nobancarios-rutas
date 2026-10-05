import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { PaymentFrequency } from "../../domain/entities/payment-frequency";
import type { PaymentMethod } from "../../domain/entities/payment-method";
import type { LoanPlanEntry } from "../../domain/entities/loan";
import { PaymentFrequencyApi } from "../../infrastructure/api/payment-frequency.api";
import { PaymentMethodApi } from "../../infrastructure/api/payment-method.api";
import { loanApi } from "../../infrastructure/api/loan.api";
import { automaticPlan, calculateInformationalRate30Days, paymentPlanDateIssue, paymentPlanDateIssueMessage } from "../../application/use-cases/loan-schedule";
import { formatCRC, moneyFromCents, normalizeMoney, parseMoneyCents } from "../../shared/utils/money";
import { costaRicaDateOnly, formatDateOnlyForDisplay } from "../../shared/utils/date";
import { MoneyInput } from "../components/MoneyInput";
import { LoanPaymentPlanTable } from "../components/LoanPaymentPlanTable";
import { useToast } from "../components/ToastContext";
import { getLoanConfirmationSummary, getLoanCreatedToastMessage } from "../helpers/loan-confirmation";
import { initialLoanCustomer, type LoanCustomer } from "../helpers/new-loan-navigation";

const cents = (value: string) => parseMoneyCents(value) ?? 0n;
const money = (value: bigint) => moneyFromCents(value);

function CustomerPicker({
  selected,
  onSelect,
}: {
  selected?: LoanCustomer;
  onSelect: (customer: LoanCustomer) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<LoanCustomer[]>([]);
  const [total, setTotal] = useState(0);
  useEffect(() => {
    if (!open) return;
    void loanApi
      .customerOptions({ search, page, pageSize: 10 })
      .then((result) => {
        setItems(result.items);
        setTotal(result.total);
      });
  }, [open, search, page]);
  return (
    <div className="loan-wizard__customer-picker">
      <button
        className="button button--secondary"
        type="button"
        onClick={() => setOpen(true)}
      >
        {selected ? "Cambiar cliente" : "Seleccionar cliente"}
      </button>
      {selected && (
        <div className="loan-wizard__selected-customer">
          <strong>{selected.fullName}</strong>
          <span>
            {selected.identification} · {selected.primaryPhone}
          </span>
          <small>{selected.address || "Sin dirección registrada"}</small>
        </div>
      )}
      {open && (
        <div className="dialog-backdrop">
          <div
            className="dialog loan-customer-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-picker-title"
          >
            <div className="loan-customer-dialog__header">
              <h3 id="customer-picker-title">Seleccionar cliente activo</h3>
            </div>
            <div className="loan-customer-dialog__search">
              <input
                className="form-control"
                autoFocus
                value={search}
                placeholder="Nombre, identificación o teléfono"
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div className="catalog-table-wrap loan-customer-dialog__table-wrap">
              <table className="catalog-table loan-customer-table">
                <thead>
                  <tr>
                    <th>Identificación</th>
                    <th>Nombre</th>
                    <th>Teléfono</th>
                    <th>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.identification}</td>
                      <td>{item.fullName}</td>
                      <td>{item.primaryPhone}</td>
                      <td>
                        <button
                          className="button button--secondary"
                          type="button"
                          onClick={() => {
                            onSelect(item);
                            setOpen(false);
                          }}
                        >
                          Seleccionar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="dialog-actions loan-customer-dialog__footer">
              <button
                className="button button--secondary"
                type="button"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Anterior
              </button>
              <span>
                {items.length
                  ? `${(page - 1) * 10 + 1}-${Math.min(page * 10, total)} de ${total}`
                  : "Sin resultados"}
              </span>
              <button
                className="button button--secondary"
                type="button"
                disabled={page * 10 >= total}
                onClick={() => setPage(page + 1)}
              >
                Siguiente
              </button>
              <button
                className="button button--secondary"
                type="button"
                onClick={() => setOpen(false)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function NewLoanPage(): ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [customer, setCustomer] = useState<LoanCustomer | undefined>(() => initialLoanCustomer(location.state));
  const [frequencies, setFrequencies] = useState<PaymentFrequency[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [paymentFrequencyId, setPaymentFrequencyId] = useState("");
  const [preferredPaymentMethodId, setPreferredPaymentMethodId] = useState("");
  const [disbursementPaymentMethodId, setDisbursementPaymentMethodId] =
    useState("");
  const [startDate, setStartDate] = useState(
    costaRicaDateOnly(),
  );
  const [principal, setPrincipal] = useState("");
  const [interestAmount, setInterestAmount] = useState("");
  const [observations, setObservations] = useState("");
  const [count, setCount] = useState("1");
  const [mode, setMode] = useState<"automatic" | "personalized">("automatic");
  const [plan, setPlan] = useState<LoanPlanEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const confirmationTriggerRef = useRef<HTMLButtonElement>(null);
  const confirmationPrimaryRef = useRef<HTMLButtonElement>(null);
  const confirmationDialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void Promise.all([
      new PaymentFrequencyApi().list(),
      new PaymentMethodApi().list(),
    ]).then(([freqs, paymentMethods]) => {
      setFrequencies(freqs.filter((item) => item.isActive));
      setMethods(paymentMethods.filter((item) => item.isActive));
    });
  }, []);
  const frequency = frequencies.find((item) => item.id === paymentFrequencyId);
  const total = useMemo(
    () => money(cents(principal) + cents(interestAmount)),
    [principal, interestAmount],
  );
  const generated = useMemo(
    () =>
      frequency
        ? automaticPlan(
            startDate,
            frequency.intervalUnit,
            frequency.intervalValue,
            Number(count),
            total,
          )
        : [],
    [frequency, startDate, count, total],
  );
  const distributed = plan.reduce(
    (sum, entry) => sum + cents(entry.pendingAmount),
    0n,
  );
  const difference = cents(total) - distributed;
  const planDateIssue = paymentPlanDateIssue(startDate, plan);
  const hasInvalidPlanRows =
    plan.length === 0 ||
    plan.some(
      (entry) =>
        !Number.isInteger(entry.sequence) ||
        entry.sequence < 1 ||
        parseMoneyCents(entry.pendingAmount) === null ||
        cents(entry.pendingAmount) <= 0n,
    ) || planDateIssue !== null;
  const continueStepOne = () => {
    if (
      !customer ||
      !frequency ||
      !principal ||
      cents(principal) <= 0n ||
      cents(interestAmount) < 0n ||
      !Number.isInteger(Number(count)) ||
      Number(count) < 1
    ) {
      setError("Completa los datos del préstamo.");
      return;
    }
    if (
      mode === "personalized" &&
      plan.length &&
      !window.confirm(
        "Los cambios del calendario se perderán. ¿Cancelar y regenerar el plan?",
      )
    )
      return;
    setPlan(generated);
    setError("");
    setStep(2);
  };
  const selectPersonalized = () => {
    setMode("personalized");
    if (!plan.length) setPlan(generated.map((entry) => ({ ...entry })));
  };
  const submit = async () => {
    if (difference !== 0n || hasInvalidPlanRows || submitting || !customer || !frequency) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await loanApi.create(
        {
          customerId: customer.id,
          paymentFrequencyId,
          preferredPaymentMethodId,
          disbursementPaymentMethodId,
          startDate,
          principal: normalizeMoney(principal),
          interestAmount: normalizeMoney(interestAmount),
          observations,
          plan: plan.map((entry) => ({ ...entry, pendingAmount: normalizeMoney(entry.pendingAmount) })),
        },
        crypto.randomUUID(),
      );
      toast.success(getLoanCreatedToastMessage(result.loanNumber));
      setConfirmationOpen(false);
      navigate(`/loans/${result.id}`);
    } catch (reason) {
      const message = reason instanceof Error && reason.message
        ? reason.message
        : "No fue posible registrar el préstamo.";
      setError(message);
      toast.error(message);
      setSubmitting(false);
    }
  };
  useEffect(() => {
    if (!confirmationOpen) return;
    confirmationPrimaryRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) {
        setConfirmationOpen(false);
        return;
      }
      if (event.key !== "Tab" || !confirmationDialogRef.current) return;
      const focusable = Array.from(confirmationDialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirmationOpen, submitting]);
  useEffect(() => {
    if (!confirmationOpen) confirmationTriggerRef.current?.focus();
  }, [confirmationOpen]);
  const confirmationSummary = getLoanConfirmationSummary({
    principal,
    interestAmount,
    total,
    planCount: plan.length,
    disbursementMethod: methods.find((item) => item.id === disbursementPaymentMethodId)?.name || "—",
  });
  const informationalRate = useMemo(
    () => calculateInformationalRate30Days(principal, interestAmount, startDate, plan),
    [principal, interestAmount, startDate, plan],
  );
  return (
    <section className="page-section loan-wizard">
      <div className="loan-wizard__card">
        <div className="loan-wizard__heading">
          <span className="eyebrow">PRÉSTAMOS</span>
          <h1>Nuevo préstamo</h1>
          <p>Registra las condiciones, distribuye el plan y confirma el desembolso.</p>
        </div>
        <div className="loan-wizard__steps" aria-label="Pasos del préstamo">
          <span className={step === 1 ? "active" : step > 1 ? "complete" : ""}>
            <b>1</b><strong>Datos del préstamo</strong>
          </span>
          <span className={step === 2 ? "active" : step > 2 ? "complete" : ""}>
            <b>2</b><strong>Plan de pagos</strong>
          </span>
          <span className={step === 3 ? "active" : ""}>
            <b>3</b><strong>Confirmación</strong>
          </span>
        </div>
        {error && <div className="catalog-message catalog-message--error loan-wizard__error" role="alert">{error}</div>}
        {step === 1 && (
          <div className="loan-wizard__form">
            <label className="loan-wizard__customer-field">
              Cliente
              <CustomerPicker selected={customer} onSelect={setCustomer} />
            </label>
            <label>
              Fecha de inicio
              <input className="loan-wizard__control" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </label>
            <label>
              Forma de pago preferida
              <select className="loan-wizard__control" value={preferredPaymentMethodId} onChange={(event) => setPreferredPaymentMethodId(event.target.value)}>
                <option value="">Seleccione</option>
                {methods.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>
              Forma de pago del desembolso
              <select className="loan-wizard__control" value={disbursementPaymentMethodId} onChange={(event) => setDisbursementPaymentMethodId(event.target.value)}>
                <option value="">Seleccione</option>
                {methods.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>
              Principal
              <MoneyInput className="loan-wizard__control" value={principal} onChange={setPrincipal} />
            </label>
            <label>
              Interés
              <MoneyInput className="loan-wizard__control" value={interestAmount} onChange={setInterestAmount} />
            </label>
            <label>
              Periodicidad
              <select className="loan-wizard__control" value={paymentFrequencyId} onChange={(event) => setPaymentFrequencyId(event.target.value)}>
                <option value="">Seleccione</option>
                {frequencies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>
              Cuotas iniciales
              <input className="loan-wizard__control" type="number" min="1" step="1" value={count} onChange={(event) => setCount(event.target.value)} />
            </label>
            <div className="loan-wizard__financial-summary">
               <span>Total del préstamo</span><strong>{formatCRC(total)}</strong><small>Tasa informativa a 30 días: {informationalRate ?? "—"}</small>
            </div>
            <label className="loan-wizard__observations">
              Observaciones
              <textarea className="loan-wizard__control" rows={3} value={observations} onChange={(event) => setObservations(event.target.value)} />
            </label>
            <div className="loan-wizard__footer">
              <button className="button button--primary" type="button" onClick={continueStepOne}>Continuar</button>
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="loan-wizard__step-content">
          <div className="dialog-actions">
             <button
              className={`button ${mode === "automatic" ? "button--primary" : "button--secondary"}`}
              type="button"
              onClick={() => {
                setMode("automatic");
                setPlan(generated);
              }}
            >
              Automático
            </button>
            <button
              className={`button ${mode === "personalized" ? "button--primary" : "button--secondary"}`}
              type="button"
              onClick={selectPersonalized}
            >
              Personalizado
            </button>
          </div>
           <div className="loan-wizard__summary" aria-label="Resumen financiero">
             <div><span>Capital</span><strong>{formatCRC(principal)}</strong></div>
             <div><span>Interés</span><strong>{formatCRC(interestAmount)}</strong></div>
             <div><span>Total</span><strong>{formatCRC(total)}</strong></div>
             <div><span>Tasa informativa a 30 días</span><strong>{informationalRate ?? "—"}</strong></div>
           </div>
            <LoanPaymentPlanTable
             plan={plan}
             total={total}
             editable={mode === "personalized"}
             onChange={setPlan}
             onAddRow={() =>
               setPlan([
                 ...plan,
                 { sequence: plan.length + 1, dueDate: "", pendingAmount: "0.00" },
               ])
             }
            />
           {mode === "personalized" && planDateIssue && <p className="form-error" role="alert">
             {paymentPlanDateIssueMessage(planDateIssue)}
           </p>}
          <div className="dialog-actions loan-wizard__footer">
            <button
              className="button button--secondary"
              type="button"
              onClick={() => setStep(1)}
            >
              Atrás
            </button>
            <button
              className="button button--primary"
              type="button"
              disabled={
                difference !== 0n ||
                 hasInvalidPlanRows
              }
              onClick={() => setStep(3)}
            >
              Continuar
            </button>
          </div>
        </div>
       )}
       {step === 3 && (
         <div className="loan-confirmation loan-wizard__step-content">
           <h2>Confirmación</h2>
           <section className="loan-confirmation__section" aria-labelledby="loan-confirmation-customer-title">
             <h3 id="loan-confirmation-customer-title">Cliente</h3>
             <div className="loan-confirmation__customer">
               <strong>{customer?.fullName}</strong>
               {customer?.identification && <span>{customer.identification}</span>}
             </div>
             <div>
               Tasa informativa a 30 días<strong>{informationalRate ?? "—"}</strong>
             </div>
           </section>
           <section className="loan-confirmation__section" aria-labelledby="loan-confirmation-summary-title">
             <h3 id="loan-confirmation-summary-title">Resumen del préstamo</h3>
             <dl className="loan-confirmation__summary">
               <div><dt>Capital</dt><dd>{formatCRC(principal)}</dd></div>
               <div><dt>Interés</dt><dd>{formatCRC(interestAmount)}</dd></div>
               <div><dt>Total a pagar</dt><dd>{formatCRC(total)}</dd></div>
                <div><dt>Tasa informativa a 30 días</dt><dd>{informationalRate ?? "—"}</dd></div>
                <div><dt>Fecha de inicio</dt><dd>{formatDateOnlyForDisplay(startDate)}</dd></div>
               <div><dt>Periodicidad</dt><dd>{frequency?.name || "—"}</dd></div>
               <div><dt>Forma de desembolso</dt><dd>{methods.find((item) => item.id === disbursementPaymentMethodId)?.name || "—"}</dd></div>
               <div><dt>Forma de pago preferida</dt><dd>{methods.find((item) => item.id === preferredPaymentMethodId)?.name || "—"}</dd></div>
             </dl>
           </section>
            <LoanPaymentPlanTable plan={plan} total={total} />
           <section className="loan-confirmation__disbursement" aria-labelledby="loan-confirmation-disbursement-title">
             <h3 id="loan-confirmation-disbursement-title">DESEMBOLSO REAL</h3>
             <strong>{formatCRC(principal)}</strong>
             <span>Principal únicamente</span>
           </section>
           <div className="dialog-actions loan-wizard__footer">
            <button
              className="button button--secondary"
              type="button"
              onClick={() => setStep(2)}
            >
              Volver
            </button>
            <button
              className="button button--primary"
              type="button"
              disabled={submitting || difference !== 0n || hasInvalidPlanRows}
               ref={confirmationTriggerRef}
               onClick={() => setConfirmationOpen(true)}
             >
               Confirmar préstamo
             </button>
          </div>
        </div>
        )}
      </div>
      {confirmationOpen && (
        <div className="dialog-backdrop loan-confirmation-backdrop">
          <div
            className="dialog loan-confirmation-dialog"
            ref={confirmationDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="loan-confirmation-dialog-title"
            aria-describedby="loan-confirmation-dialog-description"
          >
            <h2 id="loan-confirmation-dialog-title">Confirmar préstamo</h2>
            <p id="loan-confirmation-dialog-description">Revisa los datos principales antes de registrar el préstamo y realizar el desembolso.</p>
            <section className="loan-confirmation-dialog__customer" aria-label="Cliente seleccionado">
              <span className="loan-confirmation-dialog__customer-label">Cliente</span>
              <strong>{customer?.fullName}</strong>
              <span>Identificación: {customer?.identification}</span>
            </section>
            <dl className="loan-confirmation-dialog__summary">
              {confirmationSummary.map(([label, value]) => (
                <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
              ))}
            </dl>
            <section className="loan-confirmation-dialog__disbursement" aria-label="Información del desembolso">
              Este monto se registrará como egreso en movimientos de caja.
            </section>
            <p className="loan-confirmation-dialog__message">Al confirmar se registrarán el préstamo, el plan de pagos y el desembolso en caja.</p>
            <div className="dialog-actions loan-confirmation-dialog__actions">
              <button className="button button--secondary" type="button" disabled={submitting} onClick={() => setConfirmationOpen(false)}>Cancelar</button>
              <button className="button button--primary" type="button" ref={confirmationPrimaryRef} disabled={submitting} onClick={() => void submit()}>
                {submitting ? "Guardando…" : "Confirmar y desembolsar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
