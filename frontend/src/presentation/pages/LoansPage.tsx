import { useEffect, useState, type ComponentProps, type ReactElement } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { loanApi } from '../../infrastructure/api/loan.api';
import { PaymentFrequencyApi } from '../../infrastructure/api/payment-frequency.api';
import type { PaymentFrequency } from '../../domain/entities/payment-frequency';
import type { ActiveLoanListItem, LoanListItem } from '../../domain/entities/loan';
import { formatCRC } from '../../shared/utils/money';
import { formatDateOnlyForDisplay } from '../../shared/utils/date';
import { TableActions } from '../components/TableActions';
import { Icon } from '../components/layout/Icon';
import { useAuth } from '../hooks/auth-context';
import { generateLoanPaymentPlanReport } from '../../infrastructure/reports/loan-payment-plan-report.service';
import type { LoanSortBy, LoanSortOrder } from '../../infrastructure/api/loan.api';

const NewLoanLink = (props: ComponentProps<typeof RouterLink>) => {
  const { can } = useAuth();
  return can('loans.create') ? <RouterLink {...props} /> : null;
};

export function LoansPage(): ReactElement {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [items, setItems] = useState<ActiveLoanListItem[]>([]);
  const [frequencies, setFrequencies] = useState<PaymentFrequency[]>([]);
  const [search, setSearch] = useState('');
  const [frequencyId, setFrequencyId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<LoanSortBy>('number');
  const [sortOrder, setSortOrder] = useState<LoanSortOrder>('desc');
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void new PaymentFrequencyApi().list().then(setFrequencies).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las periodicidades.');
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError('');
    void loanApi.list({ page, pageSize: 20, search, frequencyId, fromDate, toDate, sortBy, sortOrder })
      .then((result) => {
        if (!mounted) return;
        setItems(result.items);
        setTotal(result.total);
      })
      .catch((cause: unknown) => {
        if (mounted) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los préstamos.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, [page, search, frequencyId, fromDate, toDate, sortBy, sortOrder]);

  const changeSort = (column: LoanSortBy) => {
    setPage(1);
    if (sortBy !== column) { setSortBy(column); setSortOrder('asc'); return; }
    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
  };

  const download = async (item: LoanListItem) => {
    try {
      const detail = await loanApi.detail(item.id);
      await generateLoanPaymentPlanReport(detail);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo descargar el plan de pago.');
    }
  };

  const hasFilters = Boolean(search || frequencyId || fromDate || toDate);
  const totalPages = Math.ceil(total / 20);
  const clearFilters = () => {
    setPage(1);
    setSearch('');
    setFrequencyId('');
    setFromDate('');
    setToDate('');
  };

  return <section className="page-section loan-list" aria-labelledby="loan-list-title">
    <div className="loan-list__heading">
       <div><span className="eyebrow">PRÉSTAMOS ACTIVOS</span><h1 id="loan-list-title">Préstamos</h1><p>Consulta y descarga los planes de pago de los préstamos activos.</p></div>
      <NewLoanLink className="button button--primary" to="/loans/new">Nuevo préstamo</NewLoanLink>
    </div>

    <div className="loan-list__surface">
      <div className="loan-list__toolbar" aria-label="Filtros de préstamos">
        <label>Buscar<input placeholder="Buscar por préstamo, cliente, identificación o teléfono" value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} /></label>
        <label>Periodicidad<select value={frequencyId} onChange={(event) => { setPage(1); setFrequencyId(event.target.value); }}><option value="">Todas las periodicidades</option>{frequencies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
         <label>Desde<input type="date" value={fromDate} onChange={(event) => { setPage(1); setFromDate(event.target.value); }} /></label>
         <label>Hasta<input type="date" value={toDate} onChange={(event) => { setPage(1); setToDate(event.target.value); }} /></label>
      </div>

      {error && <div className="loan-list__message loan-list__message--error" role="alert">{error}</div>}
      {loading && <div className="loan-list__message">Cargando préstamos…</div>}
       {!loading && !error && !items.length && !hasFilters && <div className="loan-list__message"><strong>No hay préstamos activos.</strong>{can('loans.create') && <NewLoanLink className="button button--primary" to="/loans/new">Nuevo préstamo</NewLoanLink>}</div>}
       {!loading && !error && !items.length && hasFilters && <div className="loan-list__message"><strong>No se encontraron préstamos activos con los filtros seleccionados.</strong><button className="button button--secondary" type="button" onClick={clearFilters}>Limpiar filtros</button></div>}
      {!loading && !error && items.length > 0 && <>
        <ActiveLoansTable items={items} sortBy={sortBy} sortOrder={sortOrder} onSort={changeSort} onView={(loan) => navigate(`/loans/${loan.id}`)} onDownload={download} canExport={can('loans.export')} canRegisterPayment={can('payments.view') && can('payments.create')} />
        {totalPages > 1 && <div className="loan-list__pagination"><button className="button button--secondary" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {page} de {totalPages} · {total} préstamos</span><button className="button button--secondary" type="button" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Siguiente</button></div>}
      </>}
    </div>
  </section>;
}

export function ActiveLoansTable({ items, sortBy, sortOrder, onSort, onView, onDownload, canExport, canRegisterPayment }: {
  items: ActiveLoanListItem[]; sortBy: LoanSortBy; sortOrder: LoanSortOrder; onSort: (column: LoanSortBy) => void;
  onView: (loan: ActiveLoanListItem) => void; onDownload: (loan: ActiveLoanListItem) => void; canExport: boolean; canRegisterPayment: boolean;
}): ReactElement {
  return <div className="loan-list__table-wrap"><table className="loan-list__table">
    <caption className="loan-list__sr-only">Listado de préstamos</caption>
    <thead><tr><SortableHeader column="number" label="N°" align="center" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} /><SortableHeader column="customer" label="Cliente" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} /><SortableHeader column="startDate" label="Inicio" align="center" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} /><SortableHeader column="principal" label="Cap." title="Capital" numeric sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} /><SortableHeader column="interest" label="Int." title="Interés" numeric sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} /><SortableHeader column="total" label="Total" numeric sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} /><SortableHeader column="frequency" label="Frec." title="Frecuencia" align="center" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} /><SortableHeader column="pending" label="Pend." title="Pendiente" numeric sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} /><SortableHeader column="condition" label="Condición" align="center" sortBy={sortBy} sortOrder={sortOrder} onSort={onSort} /><th className="loan-list__actions">Acciones</th></tr></thead>
    <tbody>{items.map((loan) => <tr key={loan.id}>
      <td className="loan-list__center">{loan.loanNumber}</td>
      <td><strong>{loan.customerName}</strong><small>{loan.identification}</small></td>
      <td className="loan-list__center">{formatDateOnlyForDisplay(loan.startDate)}</td>
      <td className="loan-list__numeric">{formatCRC(loan.principal)}</td>
      <td className="loan-list__numeric">{formatCRC(loan.interestAmount)}</td>
      <td className="loan-list__numeric">{formatCRC(loan.totalAmount)}</td>
      <td className="loan-list__center">{loan.frequencyName}</td>
      <td className="loan-list__numeric">{formatCRC(loan.pendingTotal)}</td>
      <td className="loan-list__center"><span className={`status-badge ${loan.isOverdue ? 'payment-loan-dialog__late' : 'status-badge--active'}`}>{loan.isOverdue ? 'CON ATRASO' : 'AL DÍA'}</span></td>
      <td className="loan-list__actions"><TableActions ariaLabel={`Acciones del préstamo ${loan.loanNumber}`} actions={[{ key: 'view', icon: 'view', label: 'Ver información', title: 'Ver información', ariaLabel: `Ver información del préstamo ${loan.loanNumber}`, onClick: () => onView(loan) }, ...(canRegisterPayment && (!('status' in loan) || loan.status === 'ACTIVE') ? [{ key: 'payment', icon: 'payment' as const, label: 'Registrar pago', title: 'Registrar pago', ariaLabel: 'Registrar pago', to: `/payments/new?loanId=${encodeURIComponent(loan.id)}` }] : []), ...(canExport ? [{ key: 'download', icon: 'download' as const, label: 'Descargar plan de pago', title: 'Descargar plan de pago', ariaLabel: `Descargar plan de pago del préstamo ${loan.loanNumber}`, onClick: () => onDownload(loan) }] : [])]} /></td>
    </tr>)}</tbody>
  </table></div>;
}

function SortableHeader({ column, label, title, align, numeric, sortBy, sortOrder, onSort }: { column: LoanSortBy; label: string; title?: string; align?: 'center'; numeric?: boolean; sortBy: LoanSortBy; sortOrder: LoanSortOrder; onSort: (column: LoanSortBy) => void }): ReactElement {
  const active = sortBy === column;
  const nextOrder = active && sortOrder === 'asc' ? 'desc' : 'asc';
  return <th className={[numeric && 'loan-list__numeric', align === 'center' && 'loan-list__center'].filter(Boolean).join(' ')} aria-sort={active ? sortOrder === 'asc' ? 'ascending' : 'descending' : 'none'}><button className="loan-sort-button" type="button" title={title} onClick={() => onSort(column)} aria-label={`${label}: ordenar ${nextOrder === 'asc' ? 'ascendente' : 'descendente'}`}><span>{label}</span><Icon name={active ? sortOrder === 'asc' ? 'sort-asc' : 'sort-desc' : 'sort'} /></button></th>;
}
