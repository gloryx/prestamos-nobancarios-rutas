import type { ReactElement, RefObject } from 'react';
import { Link } from 'react-router-dom';
import type { RefinancingResult } from '../../domain/entities/loan-refinancing';
import { formatDateOnlyForDisplay } from '../../shared/utils/date';
import { formatCRCAggregate } from '../../shared/utils/money';
import { useAuth } from '../hooks/auth-context';

export function RefinancingResultView({ result, onNew, headingRef }: {
  result: RefinancingResult; onNew?: () => void; headingRef?: RefObject<HTMLHeadingElement | null>;
}): ReactElement {
  const { can } = useAuth();
  const money = result.financialComposition;
  const hasDisbursement = result.disbursement !== null && money.newMoneyDisbursed !== '0.00';
  return <section className="page-section loan-wizard refinancing-result" aria-labelledby="refinancing-result-title">
    <div className="loan-wizard__card">
      <header className="loan-wizard__heading">
        <span className="eyebrow">REFINANCIAMIENTOS</span>
        <h1 id="refinancing-result-title" tabIndex={-1} ref={headingRef}>{onNew ? 'REFINANCIAMIENTO CREADO' : 'Detalle del refinanciamiento'}</h1>
        <p>Refinanciamiento {result.refinancingId} · {formatDateOnlyForDisplay(result.refinancingDate)}</p>
        <p>{result.customer.fullName} · {result.customer.identification}</p>
      </header>
      <div className="refinancing-result__loans">
        <section className="loan-confirmation__section" aria-label="Préstamo origen">
          <h2>PRÉSTAMO ORIGEN</h2><p>Préstamo #{result.originLoan.loanNumber}</p>
          <p>Estado: <span className="status-badge status-badge--inactive">{result.originLoan.status}</span></p>
        </section>
        <section className="loan-confirmation__section" aria-label="Préstamo nuevo">
          <h2>PRÉSTAMO NUEVO</h2><p>Préstamo #{result.newLoan.loanNumber}</p>
          <p>Estado: <span className="status-badge status-badge--active">{result.newLoan.status}</span></p>
        </section>
      </div>
      <section className="loan-confirmation__section" aria-label="Composición financiera confirmada">
        <h2>COMPOSICIÓN FINANCIERA CONFIRMADA</h2>
        <dl className="refinancing-confirmation__equation">
          <div><dt>Capital anterior pendiente refinanciado</dt><dd>{formatCRCAggregate(money.outstandingPrincipalTransferred)}</dd></div>
          <div><dt>+ Interés anterior capitalizado</dt><dd>{formatCRCAggregate(money.capitalizedOutstandingInterest)}</dd></div>
          <div><dt>+ Dinero nuevo desembolsado</dt><dd>{formatCRCAggregate(money.newMoneyDisbursed)}</dd></div>
          <div className="refinancing-confirmation__subtotal"><dt>= Principal contractual nuevo</dt><dd>{formatCRCAggregate(money.newContractualPrincipal)}</dd></div>
          <div><dt>+ Interés nuevo</dt><dd>{formatCRCAggregate(money.newInterestAmount)}</dd></div>
          <div className="refinancing-confirmation__total"><dt>= Total contractual nuevo</dt><dd>{formatCRCAggregate(money.newContractualTotal)}</dd></div>
        </dl>
      </section>
      <section className="loan-confirmation__section" aria-label="Condiciones confirmadas">
        <h2>NUEVAS CONDICIONES</h2>
        <dl className="loan-confirmation__summary">
          <div><dt>Fecha</dt><dd>{formatDateOnlyForDisplay(result.refinancingDate)}</dd></div>
          <div><dt>Periodicidad</dt><dd>{result.newContract.paymentFrequency.name}</dd></div>
          <div><dt>Forma habitual de pago</dt><dd>{result.newContract.preferredPaymentMethod.name}</dd></div>
          <div><dt>Observaciones</dt><dd>{result.newContract.observations || 'Sin observaciones'}</dd></div>
        </dl>
      </section>
      {hasDisbursement ? <section className="loan-confirmation__section" aria-label="Desembolso">
        <h2>DESEMBOLSO</h2><dl className="loan-confirmation__summary">
          <div><dt>Monto</dt><dd>{formatCRCAggregate(money.newMoneyDisbursed)}</dd></div>
          <div><dt>Forma de desembolso</dt><dd>{result.newContract.disbursementPaymentMethod?.name}</dd></div>
          <div><dt>Fecha</dt><dd>{formatDateOnlyForDisplay(result.refinancingDate)}</dd></div>
        </dl>
      </section> : <p className="loan-confirmation__section">Este refinanciamiento no generó un nuevo desembolso.</p>}
      <nav className="dialog-actions refinancing-result__actions" aria-label="Acciones del refinanciamiento">
        <Link className="button button--primary" to={`/loan-refinancings/chains/loan/${encodeURIComponent(result.originLoan.id)}`}>Ver cadena</Link>
        {can('loans.view') && <Link className="button button--primary" to={`/loans/${encodeURIComponent(result.newLoan.id)}`}>Ver nuevo préstamo</Link>}
        {onNew && <Link className="button button--secondary" to={`/loan-refinancings/${encodeURIComponent(result.refinancingId)}`}>Ver detalle del refinanciamiento</Link>}
        {onNew ? <button className="button button--secondary" type="button" onClick={onNew}>Nuevo refinanciamiento</button> :
          <Link className="button button--secondary" to="/loan-refinancings/new">Nuevo refinanciamiento</Link>}
        {can('loans.view') && <Link className="button button--secondary" to="/loans">Volver a préstamos</Link>}
      </nav>
    </div>
  </section>;
}
