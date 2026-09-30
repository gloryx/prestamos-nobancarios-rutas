import { useEffect, useState, type ReactElement } from 'react';
import { cancelledLoans } from '../../app/cancelled-loans';
import type { CancelledLoanSort, CancelledLoansQuery } from '../../application/use-cases/cancelled-loans';
import type { CancelledLoansResult } from '../../domain/entities/loan';
import { formatCRCAggregate, formatCRC } from '../../shared/utils/money';
import { formatDateOnlyForDisplay } from '../../shared/utils/date';
import { Icon } from '../components/layout/Icon';
import { TableActions } from '../components/TableActions';

const PAGE_SIZE = 20;
const empty: CancelledLoansResult = { items: [], total: 0, page: 1, pageSize: PAGE_SIZE, summary: { cancelledLoansCount: 0, recoveredAmount: '0.00', realizedProfit: '0.00' } };
const columns: { key: CancelledLoanSort; label: string }[] = [
  { key: 'loanNumber', label: 'N°' }, { key: 'customer', label: 'Cliente' }, { key: 'startDate', label: 'Inicio' },
  { key: 'cancelledDate', label: 'Cancelación' }, { key: 'principal', label: 'Capital' },
  { key: 'recoveredInterest', label: 'Interés' }, { key: 'totalRecovered', label: 'Total recuperado' },
];

export function CancelledLoansPage(): ReactElement {
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<CancelledLoanSort>('cancelledDate');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [result, setResult] = useState<CancelledLoansResult>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    const query: CancelledLoansQuery = { page, pageSize: PAGE_SIZE, search: search || undefined, startDate: startDate || undefined,
      endDate: endDate || undefined, sortBy, sortDirection };
    setLoading(true);
    setError('');
    void cancelledLoans.execute(query).then((data) => { if (mounted) setResult(data); })
      .catch((cause: unknown) => { if (mounted) { setResult(empty); setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los préstamos cancelados.'); } })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [page, search, startDate, endDate, sortBy, sortDirection]);

  const changeSort = (column: CancelledLoanSort) => {
    setPage(1);
    if (sortBy !== column) { setSortBy(column); setSortDirection('asc'); }
    else setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
  };
  return <CancelledLoansView result={result} loading={loading} error={error} search={search} startDate={startDate} endDate={endDate}
    page={page} sortBy={sortBy} sortDirection={sortDirection} onSearch={(value) => { setPage(1); setSearch(value); }}
    onStartDate={(value) => { setPage(1); setStartDate(value); }} onEndDate={(value) => { setPage(1); setEndDate(value); }}
    onSort={changeSort} onPage={setPage} />;
}

type ViewProps = { result: CancelledLoansResult; loading: boolean; error: string; search: string; startDate: string; endDate: string;
  page: number; sortBy: CancelledLoanSort; sortDirection: 'asc' | 'desc'; onSearch(value: string): void; onStartDate(value: string): void;
  onEndDate(value: string): void; onSort(column: CancelledLoanSort): void; onPage(page: number): void };

export function CancelledLoansView({ result, loading, error, search, startDate, endDate, page, sortBy, sortDirection,
  onSearch, onStartDate, onEndDate, onSort, onPage }: ViewProps): ReactElement {
  const pages = Math.ceil(result.total / PAGE_SIZE);
  const summary = loading || error ? null : result.summary;
  return <section className="page-section loan-list cancelled-loans" aria-labelledby="cancelled-loans-title">
    <div className="loan-list__heading"><div><span className="eyebrow">PRÉSTAMOS</span><h1 id="cancelled-loans-title">Préstamos cancelados</h1><p>Consulta los préstamos cancelados y los pagos efectivamente recuperados.</p></div></div>
    <div className="cancelled-loans__summary" aria-label="Resumen de préstamos cancelados">
      <div><span>Préstamos cancelados</span><strong>{summary ? summary.cancelledLoansCount : '—'}</strong></div>
      <div><span>Monto recuperado</span><strong>{summary ? formatCRCAggregate(summary.recoveredAmount) : '—'}</strong></div>
      <div><span>Ganancia</span><strong>{summary ? formatCRCAggregate(summary.realizedProfit) : '—'}</strong></div>
    </div>
    <div className="loan-list__surface">
      <div className="loan-list__toolbar" aria-label="Filtros de préstamos cancelados">
        <label>Buscar<input placeholder="Buscar por préstamo, cliente, identificación o teléfono" value={search} onChange={(event) => onSearch(event.target.value)} /></label>
        <label>Fecha inicio<input type="date" value={startDate} onChange={(event) => onStartDate(event.target.value)} /></label>
        <label>Fecha fin<input type="date" value={endDate} onChange={(event) => onEndDate(event.target.value)} /></label>
      </div>
      {error && <div className="loan-list__message loan-list__message--error" role="alert">{error}</div>}
      {loading && <div className="loan-list__message" role="status">Cargando préstamos cancelados…</div>}
      {!loading && !error && !result.items.length && <div className="loan-list__message"><strong>{result.total ? 'No hay préstamos en esta página.' : search || startDate || endDate ? 'No se encontraron préstamos cancelados con los filtros seleccionados.' : 'No hay préstamos cancelados.'}</strong></div>}
      {!loading && !error && result.items.length > 0 && <div className="loan-list__table-wrap"><table className="loan-list__table">
        <caption className="loan-list__sr-only">Listado de préstamos cancelados</caption>
        <thead><tr>{columns.map(({ key, label }) => <th key={key} aria-sort={sortBy === key ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'} className={['principal', 'recoveredInterest', 'totalRecovered'].includes(key) ? 'loan-list__numeric' : undefined}>
          <button type="button" className="loan-sort-button" onClick={() => onSort(key)} aria-label={`${label}: ordenar ${sortBy === key && sortDirection === 'asc' ? 'descendente' : 'ascendente'}`}><span>{label}</span><Icon name={sortBy === key ? sortDirection === 'asc' ? 'sort-asc' : 'sort-desc' : 'sort'} /></button>
        </th>)}<th className="loan-list__actions">Acciones</th></tr></thead>
        <tbody>{result.items.map((loan) => <tr key={loan.id}>
          <td>#{loan.loanNumber}</td><td><strong>{loan.customerName}</strong><small>{loan.identification}</small></td>
          <td>{formatDateOnlyForDisplay(loan.startDate)}</td><td>{loan.cancelledDate ? formatDateOnlyForDisplay(loan.cancelledDate) : '—'}</td>
          <td className="loan-list__numeric">{formatCRC(loan.principal)}</td><td className="loan-list__numeric">{formatCRCAggregate(loan.recoveredInterest)}</td>
          <td className="loan-list__numeric">{formatCRCAggregate(loan.totalRecovered)}</td>
          <td className="loan-list__actions"><TableActions ariaLabel={`Acciones del préstamo ${loan.loanNumber}`} actions={[{ key: 'view', icon: 'view', label: 'Ver información', title: 'Ver información', ariaLabel: `Ver información del préstamo ${loan.loanNumber}`, to: `/loans/${loan.id}` }]} /></td>
        </tr>)}</tbody>
      </table></div>}
      {!loading && !error && pages > 1 && <div className="loan-list__pagination"><button className="button button--secondary" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</button><span>Página {page} de {pages} · {result.total} préstamos</span><button className="button button--secondary" type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>Siguiente</button></div>}
    </div>
  </section>;
}
