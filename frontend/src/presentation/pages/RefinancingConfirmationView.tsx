import type { ReactElement } from 'react';
import type { RefinancingConfirmationState } from '../../application/use-cases/refinancing-confirmation-controller';
import { formatDateOnlyForDisplay } from '../../shared/utils/date';
import { formatCRCAggregate } from '../../shared/utils/money';
import { LoanPaymentPlanTable } from '../components/LoanPaymentPlanTable';
import { useAuth } from '../hooks/auth-context';
import { refinancingFailureMessage } from '../helpers/refinancing-errors';

export function RefinancingConfirmationView({ state, onBack, onConfirm }: {
  state: RefinancingConfirmationState; onBack: () => void; onConfirm: (allowed: boolean) => void;
}): ReactElement | null {
  const { can } = useAuth();
  const review = state.prepared;
  if (!review) return null;
  const { preview, request, newPrincipal, newTotal, planTotal, difference, frequencyName, preferredMethodName, disbursementMethodName } = review;
  const newMoney = request.newMoney !== '0.00';
  return <section className="refinancing-confirmation loan-wizard__step-content" aria-labelledby="refinancing-confirmation-title">
    <h2 id="refinancing-confirmation-title">Confirmación del refinanciamiento</h2>
    <section className="loan-confirmation__section" aria-label="Préstamo origen">
      <h3>PRÉSTAMO ORIGEN</h3>
      <dl className="loan-confirmation__summary">
        <div><dt>Número de préstamo</dt><dd>#{preview.loanNumber}</dd></div>
        <div><dt>Cliente</dt><dd>{preview.customer.name}</dd></div>
        <div><dt>Identificación</dt><dd>{preview.customer.identification}</dd></div>
        <div><dt>Estado actual</dt><dd>{preview.status}</dd></div>
        <div><dt>Fecha de inicio</dt><dd>{formatDateOnlyForDisplay(preview.startDate)}</dd></div>
        {([['Capital original', preview.principal], ['Interés contractual actual', preview.interestAmount],
          ['Total contractual', preview.totalAmount], ['Total pagado válido', preview.paidAmount],
          ['Capital recuperado', preview.paidPrincipal], ['Interés recuperado', preview.paidInterest],
          ['Capital pendiente', preview.outstandingPrincipal], ['Interés pendiente', preview.outstandingInterest],
          ['Saldo financiero', preview.financialBalance]] as const).map(([label, amount]) =>
          <div key={label}><dt>{label}</dt><dd>{formatCRCAggregate(amount)}</dd></div>)}
      </dl>
    </section>
    <section className="loan-confirmation__section" aria-label="Composición del refinanciamiento">
      <h3>COMPOSICIÓN DEL REFINANCIAMIENTO</h3>
      <dl className="refinancing-confirmation__equation">
        <div><dt>Capital anterior pendiente</dt><dd>{formatCRCAggregate(preview.outstandingPrincipal)}</dd></div>
        <div><dt>+ Interés anterior capitalizado</dt><dd>{formatCRCAggregate(preview.outstandingInterest)}</dd></div>
        <div><dt>+ Dinero nuevo desembolsado</dt><dd>{formatCRCAggregate(request.newMoney)}</dd></div>
        <div className="refinancing-confirmation__subtotal"><dt>= Principal contractual nuevo</dt><dd>{formatCRCAggregate(newPrincipal)}</dd></div>
        <div><dt>+ Interés nuevo</dt><dd>{formatCRCAggregate(request.newInterestAmount)}</dd></div>
        <div className="refinancing-confirmation__total"><dt>= Total contractual nuevo</dt><dd>{formatCRCAggregate(newTotal)}</dd></div>
      </dl>
    </section>
    <section className="loan-confirmation__section" aria-label="Nuevas condiciones">
      <h3>NUEVAS CONDICIONES</h3>
      <dl className="loan-confirmation__summary">
        <div><dt>Fecha del refinanciamiento</dt><dd>{formatDateOnlyForDisplay(request.refinancingDate)}</dd></div>
        <div><dt>Periodicidad</dt><dd>{frequencyName}</dd></div>
        <div><dt>Cantidad de pagos</dt><dd>{request.plan.length}</dd></div>
        <div><dt>Forma habitual de pago</dt><dd>{preferredMethodName}</dd></div>
        <div><dt>Forma de desembolso</dt><dd>{newMoney ? disbursementMethodName : 'No aplica'}</dd></div>
        <div><dt>Observaciones</dt><dd>{request.observations || 'Sin observaciones'}</dd></div>
      </dl>
    </section>
    <LoanPaymentPlanTable plan={request.plan} total={newTotal} numberLabel="#" amountLabel="Monto" />
    <section className="loan-confirmation__section" aria-label="Resumen del plan">
      <h3>RESUMEN DEL PLAN</h3><dl className="loan-confirmation__summary">
        <div><dt>Cantidad de pagos</dt><dd>{request.plan.length}</dd></div>
        <div><dt>Total del plan</dt><dd>{formatCRCAggregate(planTotal)}</dd></div>
        <div><dt>Total contractual</dt><dd>{formatCRCAggregate(newTotal)}</dd></div>
        <div><dt>Diferencia</dt><dd>{formatCRCAggregate(difference)}</dd></div>
      </dl>
    </section>
    <section className="refinancing-confirmation__warning" aria-label="Efectos al confirmar">
      <h3>AL CONFIRMAR</h3>
      <p>Al confirmar este refinanciamiento, el préstamo actual pasará a estado REFINANCED y se creará un nuevo préstamo ACTIVE con las condiciones indicadas.</p>
      <p>{newMoney ? `Se registrará un desembolso y una salida de Caja únicamente por el dinero nuevo: ${formatCRCAggregate(request.newMoney)}.` :
        'No se registrará un nuevo desembolso ni una salida de Caja.'}</p>
    </section>
    {state.failure && <p className="catalog-message catalog-message--error" role="alert">{refinancingFailureMessage(state.failure)}</p>}
    {!can('loans.refinance.create') && <p className="catalog-message catalog-message--error" role="alert">No tienes permiso para confirmar refinanciamientos.</p>}
    <footer className="dialog-actions loan-wizard__footer refinancing-conditions__footer">
      <button className="button button--secondary" type="button" disabled={state.submitting} onClick={onBack}>Volver a nuevas condiciones</button>
      {can('loans.refinance.create') && <button className="button button--primary" type="button" disabled={state.submitting || difference !== '0.00'}
        onClick={() => onConfirm(can('loans.refinance.create'))}>{state.submitting ? 'Confirmando…' : 'Confirmar refinanciamiento'}</button>}
    </footer>
  </section>;
}
