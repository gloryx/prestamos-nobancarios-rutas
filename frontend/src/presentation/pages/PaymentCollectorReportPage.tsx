import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import { createPaymentCollectorReport } from '../../app/payment-collector-report';
import { PaymentCollectorReportController, type PaymentCollectorReportState } from '../../application/use-cases/payment-collector-report-controller';
import { generatePaymentCollectorReport } from '../../infrastructure/reports/payment-collector-report.service';
import { costaRicaDateOnly } from '../../shared/utils/date';
import { formatCRCAggregate } from '../../shared/utils/money';

export function PaymentCollectorReportPage({ controller: supplied }: { controller?: PaymentCollectorReportController } = {}): ReactElement {
  const [controller] = useState(() => supplied ?? createPaymentCollectorReport());
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const exportLock = useRef(false);
  useEffect(() => { void controller.load(); return () => controller.dispose(); }, [controller]);
  const exportPdf = async () => {
    if (!state.data || exportLock.current) return;
    exportLock.current = true; setExporting(true); setExportError('');
    try { await generatePaymentCollectorReport(state.data, state.filters, costaRicaDateOnly()); }
    catch { setExportError('No se pudo exportar el reporte.'); }
    finally { exportLock.current = false; setExporting(false); }
  };
  return <PaymentCollectorReportView state={state} controller={controller} exporting={exporting} exportError={exportError}
    onExport={() => { void exportPdf(); }} />;
}

export function PaymentCollectorReportView({ state, controller, exporting, exportError, onExport }:
  { state: PaymentCollectorReportState; controller: PaymentCollectorReportController; exporting: boolean;
    exportError: string; onExport: () => void }): ReactElement {
  const { data, filters } = state;
  const maxTotal = Math.max(...(data?.collectors.map((row) => Number(row.totalReceived)) ?? [0]), 0);
  const total = Number(data?.summary.totalReceived ?? 0);
  const principal = Number(data?.summary.principalApplied ?? 0);
  const principalShare = total > 0 ? Math.max(0, Math.min(100, principal * 100 / total)) : 0;
  const metrics = [['PAGOS', data?.summary.paymentsCount.toLocaleString('es-CR')],
    ['TOTAL RECIBIDO', data && formatCRCAggregate(data.summary.totalReceived)],
    ['CAPITAL APLICADO', data && formatCRCAggregate(data.summary.principalApplied)],
    ['INTERÉS APLICADO', data && formatCRCAggregate(data.summary.interestApplied)]];
  return <section className="page-section loan-list loan-management payment-collector-report" aria-labelledby="collector-report-title">
    <div className="loan-list__heading"><div><span className="eyebrow">PAGOS</span><h1 id="collector-report-title">Cobros por cobrador</h1>
      <p>Comparativo de pagos válidos atribuidos a cada cobrador.</p></div>
      <button className="button button--secondary" type="button" disabled={!data || exporting} aria-busy={exporting} onClick={onExport}>
        {exporting ? 'Exportando…' : 'Exportar PDF'}</button></div>
    {exportError && <p role="alert" className="loan-list__message--error">{exportError}</p>}
    <div className="loan-list__surface"><div className="loan-list__toolbar payment-collector-report__filters">
      <label>Desde<input type="date" value={filters.fromDate} onChange={(event) => controller.setFilter('fromDate', event.target.value)} /></label>
      <label>Hasta<input type="date" value={filters.toDate} onChange={(event) => controller.setFilter('toDate', event.target.value)} /></label>
      <label>Cobrador<select value={filters.collectorId} disabled={!state.options} onChange={(event) => controller.setFilter('collectorId', event.target.value)}>
        <option value="">Todos</option>{state.options?.collectors.map((item) => <option key={item.id} value={item.id}>{item.name}{item.active ? '' : ' (inactivo)'}</option>)}</select></label>
      <label>Forma de pago<select value={filters.paymentMethodId} disabled={!state.options} onChange={(event) => controller.setFilter('paymentMethodId', event.target.value)}>
        <option value="">Todas</option>{state.options?.paymentMethods.map((item) => <option key={item.id} value={item.id}>{item.name}{item.active ? '' : ' (inactiva)'}</option>)}</select></label>
      <button className="button" type="button" disabled={state.loading} onClick={() => { void controller.load(); }}>Aplicar filtros</button>
      <button className="button button--secondary" type="button" disabled={state.loading} onClick={() => controller.clear()}>Limpiar</button>
    </div></div>
    <div className="loan-management__summary" aria-label="Resumen de cobros por cobrador">{metrics.map(([label, value]) =>
      <div key={label}><span>{label}</span><strong>{value ?? '—'}</strong></div>)}</div>
    {state.loading && <p role="status" className="loan-list__message">Cargando reporte…</p>}
    {state.error && <p role="alert" className="loan-list__message loan-list__message--error">{state.error}</p>}
    {data && !data.collectors.length && <p className="loan-list__message">No hay cobros atribuidos para los filtros seleccionados.</p>}
    {data && data.collectors.length > 0 && <>
      <div className="payment-collector-report__charts">
        <figure className="loan-list__surface payment-collector-report__chart"><figcaption><strong>Total por cobrador</strong><small>Comparación del monto recibido</small></figcaption>
          <div className="payment-collector-report__bars">{data.collectors.map((row) => <div key={row.collectorId} className="payment-collector-report__bar">
            <span title={row.collectorName}>{row.collectorName}</span><div><i style={{ width: `${maxTotal ? Number(row.totalReceived) * 100 / maxTotal : 0}%` }} /></div>
            <strong>{formatCRCAggregate(row.totalReceived)}</strong></div>)}</div></figure>
        <figure className="loan-list__surface payment-collector-report__chart payment-collector-report__composition"><figcaption><strong>Composición del total</strong><small>Capital e interés aplicado</small></figcaption>
          <div className="payment-collector-report__donut" role="img" aria-label={`Capital ${principalShare.toFixed(1)}%, interés ${(100 - principalShare).toFixed(1)}%`}
            style={{ background: `conic-gradient(var(--blue-500) 0 ${principalShare}%, #e6a24a ${principalShare}% 100%)` }}><span>{formatCRCAggregate(data.summary.totalReceived)}</span></div>
          <div className="payment-collector-report__legend"><span><i />Capital</span><span><i />Interés</span></div></figure>
      </div>
      <section className="loan-list__surface" aria-label="Comparativo por cobrador"><div className="loan-list__table-wrap" role="region" aria-label="Tabla de cobros por cobrador" tabIndex={0}>
        <table className="loan-list__table payment-collector-report__table"><thead><tr><th>Cobrador</th><th>Pagos</th><th>Clientes</th><th>Préstamos</th>
          <th>Total</th><th>Capital</th><th>Interés</th><th>Promedio</th><th>Participación</th></tr></thead><tbody>
          {data.collectors.map((row) => <tr key={row.collectorId}><td><strong>{row.collectorName}</strong>{!row.collectorActive && <small>Inactivo</small>}</td>
            <td>{row.paymentsCount}</td><td>{row.customersCount}</td><td>{row.loansCount}</td>
            <td className="loan-list__numeric">{formatCRCAggregate(row.totalReceived)}</td><td className="loan-list__numeric">{formatCRCAggregate(row.principalApplied)}</td>
            <td className="loan-list__numeric">{formatCRCAggregate(row.interestApplied)}</td><td className="loan-list__numeric">{formatCRCAggregate(row.averagePayment)}</td>
            <td className="loan-list__numeric">{row.participationPercentage}%</td></tr>)}</tbody></table></div></section>
    </>}
  </section>;
}
