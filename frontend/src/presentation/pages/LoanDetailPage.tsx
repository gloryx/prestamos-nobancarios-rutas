import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { LoanOperationalDetail } from '../../domain/entities/loan';
import { loanApi } from '../../infrastructure/api/loan.api';
import { generateLoanPaymentPlanReport } from '../../infrastructure/reports/loan-payment-plan-report.service';
import { formatDateOnlyForDisplay, formatDateTimeForDisplay } from '../../shared/utils/date';
import { formatCRC } from '../../shared/utils/money';
import { LoanPaymentPlanTable } from '../components/LoanPaymentPlanTable';
import { LoanEditDialog } from '../components/LoanEditDialog';
import { Icon } from '../components/layout/Icon';
import { useAuth } from '../hooks/auth-context';
import { formatLoanStatus } from '../helpers/loan';

export function LoanDetailPage({ assigned = false }: { assigned?: boolean } = {}): ReactElement {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const [loan, setLoan] = useState<LoanOperationalDetail>();
  const [exportError, setExportError] = useState('');
  const [editing, setEditing] = useState(false);
  const closeEdit = useCallback(() => setEditing(false), []);

  useEffect(() => {
    void (assigned ? loanApi.assignedDetail(id) : loanApi.detail(id)).then(setLoan);
  }, [assigned, id]);
  const refreshDetail = useCallback(async () => { setLoan(await (assigned ? loanApi.assignedDetail(id) : loanApi.detail(id))); setExportError(''); }, [assigned, id]);
  const refreshUnavailable = useCallback(async () => { try { await refreshDetail(); } catch (cause) { setExportError(cause instanceof Error ? cause.message : 'No se pudo actualizar el préstamo.'); } }, [refreshDetail]);

  const download = async () => {
    setExportError('');
    try { await generateLoanPaymentPlanReport(await loanApi.detail(id)); }
    catch (cause) { setExportError(cause instanceof Error ? cause.message : 'No se pudo mostrar el plan de pago.'); }
  };

  if (!loan) return <p>Cargando préstamo…</p>;

  return (
    <section className="loan-detail page-section">
      <header className="loan-detail__header">
        <div>
          <span className="eyebrow">PRÉSTAMO {loan.loanNumber}</span>
          <h1 tabIndex={-1}>{loan.customerName}</h1>
        </div>
        <div className="loan-detail__actions">
        {!assigned && loan.status === 'ACTIVE' && can('loans.update') && <button className="button button--secondary" type="button" onClick={() => setEditing(true)}>Editar préstamo</button>}
        {!assigned && loan.status === 'ACTIVE' && can('payments.view') && can('payments.create') && <Link className="button button--secondary" to={`/payments/new?loanId=${encodeURIComponent(loan.id)}`}><Icon name="payment" />Registrar pago</Link>}
        {!assigned && can('loans.export') && (
          <button className="button button--secondary" type="button" onClick={() => void download()}>
            Descargar plan de pago
          </button>
        )}
        </div>
      </header>
      {exportError && <p role="alert">{exportError}</p>}

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
      {!assigned && editing && can('loans.update') && <LoanEditDialog loanId={id} api={loanApi} onSaved={refreshDetail} onUnavailable={refreshUnavailable} onClose={closeEdit} />}
    </section>
  );
}
