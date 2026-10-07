import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { collectorUseCases } from '../../app/collectors';
import type { CollectorFinancialSummary } from '../../domain/entities/collector';
import type { AssignedLoanListItem } from '../../domain/entities/loan';
import { loanApi, type LoanSortBy, type LoanSortOrder } from '../../infrastructure/api/loan.api';
import { CollectorFinancialSummaryCards } from '../components/CollectorFinancialSummaryCards';
import { loadPermittedCollectorFinancialSummary } from '../helpers/collector-financial-summary';
import { useAuth } from '../hooks/auth-context';
import { ActiveLoansTable } from './LoansPage';

export function CollectorLoansPage(): ReactElement {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canViewSummary = can('collectors.financial-summary.view');
  const [items, setItems] = useState<AssignedLoanListItem[]>([]);
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState(''); const [toDate, setToDate] = useState(''); const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<LoanSortBy>('number'); const [sortOrder, setSortOrder] = useState<LoanSortOrder>('desc');
  const [total, setTotal] = useState(0); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [summary, setSummary] = useState<CollectorFinancialSummary>();
  const [summaryLoading, setSummaryLoading] = useState(canViewSummary); const [summaryError, setSummaryError] = useState('');
  const generation = useRef(0);
  const load = useCallback(async () => {
    const token = ++generation.current;
    try {
      const result = await loanApi.assignedList({ page, pageSize: 20, search, status: 'ACTIVE', fromDate, toDate, sortBy, sortOrder });
      if (token === generation.current) { setItems(result.items); setTotal(result.total); setError(''); }
    } catch (cause) { if (token === generation.current) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los préstamos asignados.'); }
    finally { if (token === generation.current) setLoading(false); }
  }, [page, search, fromDate, toDate, sortBy, sortOrder]);
  useEffect(() => { setLoading(true); void load(); return () => { ++generation.current; }; }, [load]);
  useEffect(() => {
    let active = true;
    if (!canViewSummary) { setSummary(undefined); setSummaryError(''); setSummaryLoading(false); return () => { active = false; }; }
    setSummaryLoading(true);
    void loadPermittedCollectorFinancialSummary(canViewSummary, () => collectorUseCases.financialSummary.execute())
      .then((value) => { if (active) { setSummary(value); setSummaryError(''); } })
      .catch((cause: unknown) => { if (active) setSummaryError(cause instanceof Error ? cause.message : 'No se pudo cargar tu resumen financiero.'); })
      .finally(() => { if (active) setSummaryLoading(false); });
    return () => { active = false; };
  }, [canViewSummary]);
  const changeSort = (column: LoanSortBy) => { setPage(1); if (sortBy !== column) { setSortBy(column); setSortOrder('asc'); } else setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc'); };
  const clear = () => { setPage(1); setSearch(''); setFromDate(''); setToDate(''); };
  const hasFilters = Boolean(search || fromDate || toDate); const totalPages = Math.ceil(total / 20);
  return <section className="page-section loan-list" aria-labelledby="collector-loans-title">
    <div className="loan-list__heading"><div><span className="eyebrow">COBRADOR</span><h1 id="collector-loans-title">Mis préstamos activos</h1><p>Cartera activa de tus clientes actualmente asignados.</p></div></div>
    <CollectorLoansFinancialSummary visible={canViewSummary} summary={summary} loading={summaryLoading} error={summaryError} />
    <div className="loan-list__surface"><div className="loan-list__toolbar" aria-label="Filtros de mis préstamos activos">
      <label>Buscar<input placeholder="Préstamo, cliente, identificación o teléfono" value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} /></label>
      <label>Desde<input type="date" value={fromDate} onChange={(event) => { setPage(1); setFromDate(event.target.value); }} /></label>
      <label>Hasta<input type="date" value={toDate} onChange={(event) => { setPage(1); setToDate(event.target.value); }} /></label>
    </div>
    {error && <div className="loan-list__message loan-list__message--error" role="alert">{error}</div>}
    {loading && <div className="loan-list__message">Cargando préstamos…</div>}
    {!loading && !error && !items.length && <div className="loan-list__message"><strong>{hasFilters ? 'No se encontraron préstamos activos con los filtros seleccionados.' : 'No tenés préstamos activos asignados.'}</strong>{hasFilters && <button className="button button--secondary" type="button" onClick={clear}>Limpiar filtros</button>}</div>}
    {!loading && !error && items.length > 0 && <><ActiveLoansTable items={items} sortBy={sortBy} sortOrder={sortOrder} onSort={changeSort}
      onView={(loan) => navigate(`/collector/loans/${loan.id}`)} onEdit={() => {}} onDownload={() => {}} canEdit={false} canExport={false} canRegisterPayment={false} showStatus showCollectorDetails />
      {totalPages > 1 && <div className="loan-list__pagination"><button className="button button--secondary" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {page} de {totalPages} · {total} préstamos</span><button className="button button--secondary" type="button" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Siguiente</button></div>}</>}
    </div>
  </section>;
}

export function CollectorLoansFinancialSummary({ visible, summary, loading, error }: {
  visible: boolean; summary?: CollectorFinancialSummary; loading: boolean; error: string;
}): ReactElement | null {
  if (!visible) return null;
  return <div className="collector-summary collector-loans__summary" aria-label="Resumen financiero de préstamos activos">
    {loading && <div className="collector-summary__message" aria-live="polite">Cargando resumen financiero…</div>}
    {error && <div className="collector-summary__message collector-summary__message--error" role="alert">{error}</div>}
    {!loading && !error && summary && <CollectorFinancialSummaryCards summary={summary} />}
  </div>;
}
