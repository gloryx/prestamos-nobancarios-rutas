import type { ReactElement } from 'react';
import { RefinancingConditionsController, type RefinancingConditionsState } from '../../application/use-cases/refinancing-conditions-controller';
import { calculateInformationalRate30Days, paymentPlanDateIssueMessage } from '../../application/use-cases/loan-schedule';
import { HttpApiError } from '../../infrastructure/api/api-client';
import { formatCRC, formatCRCAggregate, parseMoneyCents } from '../../shared/utils/money';
import { costaRicaDateOnly } from '../../shared/utils/date';
import { LoanPaymentPlanTable } from '../components/LoanPaymentPlanTable';
import { MoneyInput } from '../components/MoneyInput';

export function RefinancingConditionsView({ state, controller, onBack, onContinue }: {
  state: RefinancingConditionsState; controller: RefinancingConditionsController; onBack: () => void;
  onContinue?: () => void;
}): ReactElement {
  const { preview, conditions, frequencies, methods } = state;
  const draft = controller.evaluate();
  const newMoney = parseMoneyCents(conditions.newMoney);
  const today = costaRicaDateOnly();
  const rate = draft?.principal && draft.total && draft.planValid
    ? calculateInformationalRate30Days(draft.principal, conditions.newInterestAmount, conditions.refinancingDate, draft.plan) : null;
  return <section className="refinancing-conditions loan-wizard__step-content" aria-labelledby="refinancing-conditions-title">
    <h2 id="refinancing-conditions-title">Nuevas condiciones y plan de pagos</h2>
    {preview && <p className="refinancing-conditions__origin">Préstamo origen #{preview.loanNumber} · {preview.customer.name} · {preview.customer.identification}</p>}
    {state.loadingOptions && <p role="status" className="loan-list__message">Cargando periodicidades y formas de pago…</p>}
    {state.optionsError !== null && <div role="alert" className="loan-list__message loan-list__message--error">
      {state.optionsError instanceof HttpApiError && state.optionsError.status === 403 ?
        'No tienes permiso para consultar las periodicidades o formas de pago.' :
        'No se pudieron cargar las opciones de pago. Intenta nuevamente.'}
      <button type="button" className="button button--secondary" onClick={() => { void controller.loadOptions(); }}>Reintentar</button>
    </div>}
    {preview && <section className="loan-confirmation__section" aria-label="Composición de la nueva obligación">
      <h3>COMPOSICIÓN DE LA NUEVA OBLIGACIÓN</h3>
      <dl className="loan-confirmation__summary">
        <div><dt>Capital anterior pendiente</dt><dd>{formatCRCAggregate(preview.outstandingPrincipal)}</dd></div>
        <div><dt>Interés anterior pendiente capitalizado</dt><dd>{formatCRCAggregate(preview.outstandingInterest)}</dd></div>
        <div><dt>Dinero nuevo</dt><dd>{newMoney !== null ? formatCRC(conditions.newMoney) : '—'}</dd></div>
        <div><dt>Nuevo capital contractual</dt><dd>{draft?.amountsValid && draft.principal ? formatCRCAggregate(draft.principal) : '—'}</dd></div>
        <div><dt>Interés nuevo</dt><dd>{parseMoneyCents(conditions.newInterestAmount) !== null ? formatCRC(conditions.newInterestAmount) : '—'}</dd></div>
        <div><dt>Nuevo total a pagar</dt><dd>{draft?.amountsValid && draft.total ? formatCRCAggregate(draft.total) : '—'}</dd></div>
      </dl>
      <p className="refinancing-conditions__hint">El interés pendiente se incorpora al nuevo capital. Solo el dinero nuevo representa un desembolso real.</p>
    </section>}
    <div className="loan-wizard__form refinancing-conditions__form">
      <label>Fecha de refinanciamiento
        <input className="loan-wizard__control" type="date" min={preview?.startDate} max={today} value={conditions.refinancingDate}
          onChange={(event) => controller.setConditions({ refinancingDate: event.target.value })} />
      </label>
      <label>Dinero nuevo
        <MoneyInput className="loan-wizard__control" aria-label="Dinero nuevo" value={conditions.newMoney}
          onChange={(newMoneyValue) => controller.setConditions({ newMoney: newMoneyValue })} />
      </label>
      <label>Interés nuevo
        <MoneyInput className="loan-wizard__control" aria-label="Interés nuevo" value={conditions.newInterestAmount}
          onChange={(newInterestAmount) => controller.setConditions({ newInterestAmount })} />
      </label>
      <label>Periodicidad
        <select className="loan-wizard__control" value={conditions.paymentFrequencyId} disabled={!state.optionsLoaded}
          onChange={(event) => controller.setConditions({ paymentFrequencyId: event.target.value })}>
          <option value="">Seleccione</option>
          {frequencies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label>Forma de pago preferida
        <select className="loan-wizard__control" value={conditions.preferredPaymentMethodId} disabled={!state.optionsLoaded}
          onChange={(event) => controller.setConditions({ preferredPaymentMethodId: event.target.value })}>
          <option value="">Seleccione</option>
          {methods.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      {newMoney !== 0n && <label>Forma de desembolso del dinero nuevo
        <select className="loan-wizard__control" value={conditions.disbursementPaymentMethodId} disabled={!state.optionsLoaded}
          onChange={(event) => controller.setConditions({ disbursementPaymentMethodId: event.target.value })}>
          <option value="">Seleccione</option>
          {methods.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>}
      <label>Número de cuotas
        <input className="loan-wizard__control" type="number" min="1" max="1000" step="1" value={conditions.count}
          onChange={(event) => controller.setConditions({ count: event.target.value })} />
      </label>
      <label className="loan-wizard__observations">Observaciones
        <textarea className="loan-wizard__control" rows={3} value={conditions.observations}
          onChange={(event) => controller.setConditions({ observations: event.target.value })} />
      </label>
    </div>
    <div className="dialog-actions refinancing-conditions__modes" aria-label="Modo del plan de pagos">
      <button className={`button ${conditions.mode === 'automatic' ? 'button--primary' : 'button--secondary'}`} type="button"
        aria-pressed={conditions.mode === 'automatic'} onClick={() => {
          if (conditions.mode === 'personalized' && conditions.customPlan.length &&
            !window.confirm('Los cambios del plan personalizado se perderán. ¿Regenerar el plan automático?')) return;
          controller.setMode('automatic');
        }}>Automático</button>
      <button className={`button ${conditions.mode === 'personalized' ? 'button--primary' : 'button--secondary'}`} type="button"
        aria-pressed={conditions.mode === 'personalized'} disabled={conditions.mode !== 'personalized' && !draft?.generated.length}
        onClick={() => controller.setMode('personalized')}>Personalizado</button>
    </div>
    {draft && <>
      <LoanPaymentPlanTable plan={draft.plan} total={draft.amountsValid && draft.total ? draft.total : '0.00'}
        editable={conditions.mode === 'personalized'} onChange={(plan) => controller.setCustomPlan(plan)}
        onAddRow={() => controller.setCustomPlan([...conditions.customPlan,
          { sequence: conditions.customPlan.length + 1, dueDate: '', pendingAmount: '0.00' }])} />
      <p className="refinancing-conditions__hint">Tasa informativa a 30 días: {rate ?? '—'}</p>
      {!draft.amountsValid && <p className="refinancing-conditions__warning">Revisa los importes; el nuevo capital y total deben ser válidos.</p>}
      {!draft.dateValid && <p className="refinancing-conditions__warning">La fecha debe ser válida, posterior o igual al inicio del préstamo origen y no futura.</p>}
      {!draft.countValid && <p className="refinancing-conditions__warning">Indica entre 1 y 1000 cuotas con al menos ₡0,01 cada una.</p>}
      {state.optionsLoaded && (!conditions.paymentFrequencyId || !draft.methodsValid) &&
        <p className="refinancing-conditions__warning">Selecciona una periodicidad y las formas de pago requeridas.</p>}
      {draft.plan.length > 0 && (!draft.planValid || draft.difference !== 0n) &&
        <p className="refinancing-conditions__warning">{paymentPlanDateIssueMessage(draft.planDateIssue) ??
          'Las cuotas deben ser positivas, tener fechas posteriores en orden y sumar exactamente el nuevo total.'}</p>}
    </>}
    <section className="loan-confirmation__disbursement" aria-label="Desembolso real">
      <h3>DESEMBOLSO REAL</h3><strong>{newMoney !== null ? formatCRC(conditions.newMoney) : '—'}</strong>
      <span>Solo el dinero nuevo; el saldo anterior no genera salida de caja.</span>
    </section>
    <footer className="dialog-actions loan-wizard__footer refinancing-conditions__footer">
      <button className="button button--secondary" type="button" onClick={onBack}>Volver al préstamo origen</button>
      <button className="button button--primary" type="button" disabled={!onContinue || !controller.canProceed()}
        onClick={onContinue} aria-label="Continuar a confirmación">Continuar</button>
    </footer>
  </section>;
}
