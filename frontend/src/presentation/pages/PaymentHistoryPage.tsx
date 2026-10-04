import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement, type RefObject } from 'react';
import { createPaymentHistory } from '../../app/payment-history';
import { PaymentHistoryController, type PaymentHistoryState } from '../../application/use-cases/payment-history-controller';
import type { PaymentHistoryItem, PaymentHistorySort } from '../../domain/entities/payment-history';
import { formatDateOnlyForDisplay } from '../../shared/utils/date';
import { formatCRCAggregate } from '../../shared/utils/money';
import { TableActions } from '../components/TableActions';
import { exportPaymentHistory } from '../helpers/payment-history-export';

const installments = (item: PaymentHistoryItem) => item.installments.join(', ') || '—';
const statusLabel = (item: PaymentHistoryItem) => item.status === 'VALID' ? 'Válido' : 'Anulado';

export function PaymentHistoryPage({ controller: supplied }: { controller?: PaymentHistoryController } = {}): ReactElement {
  const [controller] = useState(() => supplied ?? createPaymentHistory());
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [selected, setSelected] = useState<PaymentHistoryItem | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const exportLock = useRef(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { void controller.load(); void controller.loadOptions(); }, [controller]);
  useEffect(() => { if (!selected) return; const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus(); const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelected(null); };
    document.addEventListener('keydown', escape); return () => { document.removeEventListener('keydown', escape); previous?.focus(); }; }, [selected]);
  const exportPdf = async () => {
    if (exportLock.current) return;
    exportLock.current = true; setExporting(true); setExportError('');
    const snapshot = controller.getSnapshot();
    try { await exportPaymentHistory(controller, snapshot); }
    catch { setExportError('No se pudo exportar el historial de pagos.'); }
    finally { exportLock.current = false; setExporting(false); }
  };
  return <PaymentHistoryView state={state} controller={controller} selected={selected} onSelect={setSelected}
    onClose={() => setSelected(null)} closeRef={closeRef} exporting={exporting} exportError={exportError}
    onExport={() => { void exportPdf(); }} />;
}

export function PaymentHistoryView({ state, controller, selected, onSelect, onClose, closeRef, exporting, exportError, onExport }:
  { state: PaymentHistoryState; controller: PaymentHistoryController; selected: PaymentHistoryItem | null;
    onSelect: (item: PaymentHistoryItem) => void; onClose: () => void; closeRef?: RefObject<HTMLButtonElement | null>;
    exporting: boolean; exportError: string; onExport: () => void }): ReactElement {
  const { filters, data } = state;
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / state.pageSize));
  const metrics = [
    ['PAGOS VÁLIDOS', data?.summary.validPaymentsCount.toLocaleString('es-CR')],
    ['TOTAL RECIBIDO', data && formatCRCAggregate(data.summary.receivedAmount)],
    ['CAPITAL APLICADO', data && formatCRCAggregate(data.summary.principalAppliedAmount)],
    ['INTERÉS APLICADO', data && formatCRCAggregate(data.summary.interestAppliedAmount)],
  ];
  const sorts: Array<{ key: PaymentHistorySort; label: string }> = [
    { key: 'paymentDate', label: 'Fecha' }, { key: 'customer', label: 'Cliente' },
    { key: 'loanNumber', label: 'Préstamo' }, { key: 'amount', label: 'Monto' }, { key: 'status', label: 'Estado' },
  ];
  const heading = (key: PaymentHistorySort) => { const sort = sorts.find((entry) => entry.key === key)!;
    return <th key={key} aria-sort={state.sortBy === key ? state.sortDir === 'asc' ? 'ascending' : 'descending' : 'none'}>
      <button type="button" className="loan-sort-button" onClick={() => controller.setSort(key)}>{sort.label}{state.sortBy === key ? (state.sortDir === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>; };
  return <section className="page-section loan-list loan-management payment-history" aria-labelledby="payment-history-title">
    <div className="loan-list__heading"><div><span className="eyebrow">PAGOS</span><h1 id="payment-history-title">Historial de pagos</h1>
      <p>Consulta operativa y auditable de pagos históricos.</p></div>
      <button className="button button--secondary" type="button" disabled={exporting} aria-busy={exporting} onClick={onExport}>
        {exporting ? 'Exportando…' : 'Exportar PDF'}</button></div>
    {exportError && <p role="alert" className="loan-list__message--error">{exportError}</p>}
    <div className="loan-list__surface"><div className="loan-list__toolbar payment-history__filters">
      <label>Desde<input type="date" value={filters.startDate} onChange={(event) => controller.setFilter('startDate', event.target.value)} /></label>
      <label>Hasta<input type="date" value={filters.endDate} onChange={(event) => controller.setFilter('endDate', event.target.value)} /></label>
      <label>Cliente<input value={filters.search} placeholder="Nombre, identificación o teléfono" onChange={(event) => controller.setFilter('search', event.target.value)} /></label>
      <label>Préstamo<input inputMode="numeric" value={filters.loanNumber} placeholder="Número de préstamo" onChange={(event) => controller.setFilter('loanNumber', event.target.value)} /></label>
      <label>Estado<select value={filters.status} onChange={(event) => controller.setFilter('status', event.target.value as typeof filters.status)}>
        <option value="">Todos</option><option value="VALID">Válidos</option><option value="ANNULLED">Anulados</option></select></label>
      <label>Forma<select value={filters.paymentMethodId} disabled={!state.options} onChange={(event) => controller.setFilter('paymentMethodId', event.target.value)}>
        <option value="">Todas</option>{state.options?.paymentMethods.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Cobrador<select value={filters.collectorId} disabled={!state.options} onChange={(event) => controller.setFilter('collectorId', event.target.value)}>
        <option value="">Todos</option>{state.options?.collectors.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <button className="button button--secondary" type="button" onClick={() => controller.clear()}>Limpiar filtros</button>
    </div></div>
    {state.optionsError && <p role="alert" className="loan-list__message--error">Opciones: {state.optionsError}</p>}
    <div className="loan-management__summary" aria-label="Resumen del historial de pagos">{metrics.map(([label, value]) =>
      <div key={label}><span>{label}</span><strong>{value ?? '—'}</strong></div>)}</div>
    <section className="loan-list__surface" aria-label="Pagos históricos">
      {state.loading && <p role="status" className="loan-list__message">Cargando historial de pagos…</p>}
      {state.error && <p role="alert" className="loan-list__message loan-list__message--error">{state.error}</p>}
      {data && !data.items.length && <p className="loan-list__message">No hay pagos para los filtros seleccionados.</p>}
      {data && data.items.length > 0 && <div className="loan-list__table-wrap" role="region" aria-label="Tabla de pagos históricos" tabIndex={0}>
        <table className="loan-list__table"><thead><tr>{heading('paymentDate')}{heading('customer')}{heading('loanNumber')}
          <th>Cuota</th>{heading('amount')}{heading('status')}<th className="loan-list__actions">Acción</th></tr></thead><tbody>
          {data.items.map((item) => <tr key={item.paymentId}><td>{formatDateOnlyForDisplay(item.paymentDate)}</td>
            <td><strong>{item.customer.fullName}</strong><small>{[item.customer.identification, item.customer.primaryPhone].filter(Boolean).join(' · ')}</small></td>
            <td>#{item.loan.loanNumber}</td><td>{installments(item)}</td><td className="loan-list__numeric">{formatCRCAggregate(item.amount)}</td>
            <td><span className={`status-badge status-badge--${item.status === 'VALID' ? 'active' : 'inactive'}`}>{statusLabel(item)}</span></td>
            <td className="loan-list__actions"><TableActions ariaLabel={`Acciones del pago ${item.paymentId}`} actions={[{ key: 'view', icon: 'view',
              label: 'Ver', title: 'Ver detalle del pago', ariaLabel: `Ver pago del préstamo ${item.loan.loanNumber}`,
              onClick: () => onSelect(item) }]} /></td></tr>)}</tbody></table></div>}
      {data && <nav className="loan-list__pagination" aria-label="Páginas del historial de pagos">
        <label>Filas <select value={state.pageSize} onChange={(event) => controller.setPageSize(Number(event.target.value))}>
          <option value={10}>10</option><option value={20}>20</option><option value={50}>50</option></select></label>
        <button className="button button--secondary" type="button" disabled={state.page <= 1} onClick={() => controller.setPage(state.page - 1)}>Anterior</button>
        <span>Página {state.page} de {pages} · {data.total} registros</span>
        <button className="button button--secondary" type="button" disabled={state.page >= pages} onClick={() => controller.setPage(state.page + 1)}>Siguiente</button>
      </nav>}
    </section>
    {selected && <div className="dialog-backdrop"><div className="dialog payment-history__dialog" role="dialog" aria-modal="true" aria-labelledby="payment-history-detail-title">
      <h2 id="payment-history-detail-title">Detalle del pago</h2><dl>{[
        ['Fecha', formatDateOnlyForDisplay(selected.paymentDate)], ['Cliente', selected.customer.fullName],
        ['Préstamo', `#${selected.loan.loanNumber}`], ['Cuota(s)', installments(selected)],
        ['Monto', formatCRCAggregate(selected.amount)], ['Capital aplicado', formatCRCAggregate(selected.principalApplied)],
        ['Interés aplicado', formatCRCAggregate(selected.interestApplied)], ['Forma de pago', selected.paymentMethod.name],
        ['Cobrador', selected.collector?.name ?? '—'], ['Estado', statusLabel(selected)],
      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <div className="dialog-actions"><button className="button button--secondary" type="button" ref={closeRef} onClick={onClose}>Cerrar</button></div>
    </div></div>}
  </section>;
}
