import { useEffect, useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import type { LoanDetail } from '../../domain/entities/loan';
import { loanApi } from '../../infrastructure/api/loan.api';
import { generateLoanPaymentPlanReport } from '../../infrastructure/reports/loan-payment-plan-report.service';
import { formatDateOnlyForDisplay, formatDateTimeForDisplay } from '../../shared/utils/date';
import { formatCRC } from '../../shared/utils/money';
import { LoanPaymentPlanTable } from '../components/LoanPaymentPlanTable';
import { useAuth } from '../hooks/auth-context';
import { formatLoanStatus } from '../helpers/loan';

export function LoanDetailPage(): ReactElement {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const [loan, setLoan] = useState<LoanDetail>();

  useEffect(() => {
    void loanApi.detail(id).then(setLoan);
  }, [id]);

  if (!loan) return <p>Cargando préstamo…</p>;

  return (
    <section className="loan-detail page-section">
      <header className="loan-detail__header">
        <div>
          <span className="eyebrow">PRÉSTAMO {loan.loanNumber}</span>
          <h1>{loan.customerName}</h1>
        </div>
        {can('loans.export') && (
          <button className="button button--secondary" type="button" onClick={() => void generateLoanPaymentPlanReport(loan)}>
            Descargar plan de pago
          </button>
        )}
      </header>

      <section className="loan-detail__info" aria-labelledby="loan-detail-info-title">
        <h2 id="loan-detail-info-title">INFORMACIÓN DEL PRÉSTAMO</h2>
        <dl className="loan-detail__grid">
          <div><dt>Cliente</dt><dd>{loan.customerName} · {loan.identification}</dd></div>
          <div><dt>Inicio</dt><dd>{formatDateOnlyForDisplay(loan.startDate)}</dd></div>
          <div><dt>Principal</dt><dd>{formatCRC(loan.principal)}</dd></div>
          <div><dt>Interés</dt><dd>{formatCRC(loan.interestAmount)}</dd></div>
          <div><dt>Total</dt><dd>{formatCRC(loan.totalAmount)}</dd></div>
          <div><dt>Pendiente actual</dt><dd>{formatCRC(loan.pendingTotal)}</dd></div>
          <div><dt>Frecuencia</dt><dd>{loan.frequencyName}</dd></div>
          <div><dt>Estado</dt><dd><span className="loan-detail__status">{formatLoanStatus(loan.status)}</span></dd></div>
          <div><dt>Forma preferida</dt><dd>{loan.preferredPaymentMethod}</dd></div>
          <div><dt>Forma de desembolso</dt><dd>{loan.disbursementPaymentMethod}</dd></div>
          <div><dt>Creado por</dt><dd>{loan.createdByName}</dd></div>
          <div><dt>Actualizado</dt><dd>{formatDateTimeForDisplay(loan.updatedAt)}</dd></div>
          <div className="loan-detail__observations"><dt>Observaciones</dt><dd>{loan.observations || '—'}</dd></div>
        </dl>
      </section>

      <LoanPaymentPlanTable plan={loan.plan} total={loan.totalAmount} showCondition />
    </section>
  );
}
