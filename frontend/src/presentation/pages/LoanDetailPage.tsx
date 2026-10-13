import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AssignedLoanDetail, LoanOperationalDetail } from '../../domain/entities/loan';
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
  const [loan, setLoan] = useState<AssignedLoanDetail | LoanOperationalDetail>();
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

      {'collectionProjection' in loan && loan.collectionProjection.operationalDate && <section className="payment-selected__collection" aria-label="Próximo cobro consolidado">
        <div><span>{loan.collectionProjection.operationalDateKind === 'TODAY' ? 'COBRO PENDIENTE HOY' : 'PRÓXIMO COBRO'}</span><strong>{formatCRC(loan.collectionProjection.totalSuggestedAmount)}</strong><small>{formatDateOnlyForDisplay(loan.collectionProjection.operationalDate)}</small></div>
        <dl><div><dt>Saldo vencido</dt><dd>{formatCRC(loan.collectionProjection.overdueAmount)}</dd></div><div><dt>Próximo monto programado</dt><dd>{formatCRC(loan.collectionProjection.scheduledAmount)}</dd></div><div><dt>Total sugerido a cobrar</dt><dd>{formatCRC(loan.collectionProjection.totalSuggestedAmount)}</dd></div></dl>
      </section>}

      <LoanPaymentPlanTable plan={loan.plan} total={loan.financialBalance} showCondition hideReprogrammed paymentApplications={loan.validPayments.flatMap((payment) => payment.applications ?? [])} />
      <section className="payment-selected__plan" aria-labelledby="loan-payment-movements-title"><h2 id="loan-payment-movements-title">Movimientos de pago</h2>
        <div className="payment-selected__table-wrap"><table className="catalog-table payment-selected__table"><thead><tr><th>Referencia</th><th>Fecha</th><th>Monto recibido</th></tr></thead>
          <tbody>{loan.validPayments.map((payment) => <tr className="payment-plan-row payment-plan-row--payment" key={payment.id}><td>PAGO RECIBIDO</td><td>{formatDateOnlyForDisplay(payment.paymentDate)}</td><td>{formatCRC(payment.amount)}</td></tr>)}</tbody></table></div>
        {!loan.validPayments.length && <p>No hay pagos válidos registrados.</p>}
      </section>
      {!assigned && editing && can('loans.update') && <LoanEditDialog loanId={id} api={loanApi} onSaved={refreshDetail} onUnavailable={refreshUnavailable} onClose={closeEdit} />}
    </section>
  );
}
