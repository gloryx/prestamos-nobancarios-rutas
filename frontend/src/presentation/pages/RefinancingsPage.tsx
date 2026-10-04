import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { createRefinancingList } from '../../app/loan-refinancing';
import { RefinancingListController, type RefinancingListState } from '../../application/use-cases/refinancing-list-controller';
import type { RefinancingCustomerOption } from '../../application/ports/loan-refinancing.repository';
import type { RefinancingPageSize } from '../../domain/entities/loan-refinancing';
import { HttpApiError } from '../../infrastructure/api/api-client';
import { formatDateOnlyForDisplay } from '../../shared/utils/date';
import { formatCRCAggregate } from '../../shared/utils/money';
import { TableActions } from '../components/TableActions';
import { useAuth } from '../hooks/auth-context';

function loadError(error: unknown, kind: 'list' | 'customers'): string {
  if (error instanceof HttpApiError && error.status === 403) return kind === 'customers' ?
    'No tienes permiso para consultar clientes.' : 'No tienes permiso para consultar refinanciamientos.';
  if (error instanceof TypeError) return 'No se pudo conectar al servidor. Intenta nuevamente.';
  return kind === 'customers' ? 'No se pudieron cargar los clientes. Intenta nuevamente.' :
    'No se pudieron cargar los refinanciamientos. Intenta nuevamente.';
}

export function RefinancingsPage({ controller: supplied }: { controller?: RefinancingListController } = {}): ReactElement {
  const { can } = useAuth();
  const canSelectCustomer = can('customers.view');
  const [controller] = useState(() => supplied ?? createRefinancingList());
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [customerOpen, setCustomerOpen] = useState(false);
  const customerSearchRef = useRef<HTMLInputElement>(null);
  const customerTriggerRef = useRef<HTMLButtonElement>(null);
  const previousSearch = useRef(state.filters.search);
  const previousCustomerSearch = useRef(state.customerSearch);
  useEffect(() => {
    const delay = previousSearch.current !== state.filters.search && state.filters.search.trim() ? 250 : 0;
    previousSearch.current = state.filters.search;
    const timer = window.setTimeout(() => { void controller.load(); }, delay);
    return () => window.clearTimeout(timer);
  }, [controller, state.filters.search, state.filters.dateFrom, state.filters.dateTo,
    state.selectedCustomer?.id, state.page, state.pageSize]);
  useEffect(() => {
    if (!customerOpen || !canSelectCustomer) return;
    const delay = previousCustomerSearch.current !== state.customerSearch && state.customerSearch.trim() ? 250 : 0;
    previousCustomerSearch.current = state.customerSearch;
    const timer = window.setTimeout(() => { void controller.loadCustomers(); }, delay);
    return () => window.clearTimeout(timer);
  }, [controller, customerOpen, state.customerSearch, state.customerPage, canSelectCustomer]);
  useEffect(() => {
    if (!customerOpen) return;
    customerSearchRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setCustomerOpen(false); };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); controller.closeCustomerSearch(); customerTriggerRef.current?.focus(); };
  }, [customerOpen, controller]);
  useEffect(() => () => { if (!supplied) controller.dispose(); }, [controller, supplied]);
  const openCustomer = () => { controller.openCustomerSearch(); setCustomerOpen(true); };
  const closeCustomer = () => setCustomerOpen(false);
  return <RefinancingsView state={state} controller={controller} canViewLoans={can('loans.view')}
    canSelectCustomer={canSelectCustomer} customerOpen={customerOpen} onOpenCustomer={openCustomer}
    onCloseCustomer={closeCustomer} customerSearchRef={customerSearchRef} customerTriggerRef={customerTriggerRef} />;
}

export function RefinancingsView({ state, controller, canViewLoans, canSelectCustomer, customerOpen,
  onOpenCustomer, onCloseCustomer, customerSearchRef, customerTriggerRef }: {
  state: RefinancingListState; controller: RefinancingListController; canViewLoans: boolean; canSelectCustomer: boolean;
  customerOpen: boolean; onOpenCustomer: () => void; onCloseCustomer: () => void;
  customerSearchRef?: RefObject<HTMLInputElement | null>; customerTriggerRef?: RefObject<HTMLButtonElement | null>;
}): ReactElement {
  const { filters, data, selectedCustomer } = state;
  const hasFilters = Boolean(filters.search.trim() || filters.dateFrom || filters.dateTo || selectedCustomer);
  const start = data?.items.length ? (data.page - 1) * data.pageSize + 1 : 0;
  const end = data?.items.length ? start + data.items.length - 1 : 0;
  return <section className="page-section loan-list refinancing-list" aria-labelledby="refinancings-title">
    <header className="loan-list__heading"><div><span className="eyebrow">REFINANCIAMIENTOS</span>
      <h1 id="refinancings-title">Refinanciamientos</h1>
      <p>Consulta y analiza las operaciones de refinanciamiento registradas.</p></div>
      <Link className="button button--secondary" to="/loan-refinancings/new">Nuevo refinanciamiento</Link>
    </header>
    <div className="loan-list__surface">
      <div className="loan-list__toolbar refinancing-list__filters" aria-label="Filtros de refinanciamientos">
        <label>Buscar<input type="search" maxLength={120} value={filters.search}
          placeholder="Cliente, identificación o número de préstamo"
          onChange={(event) => controller.setFilter('search', event.target.value)} /></label>
        <div className="refinancing-list__client-filter"><span>Cliente</span>
          {selectedCustomer && <strong>{selectedCustomer.fullName} · {selectedCustomer.identification}</strong>}
          <button ref={customerTriggerRef} className="button button--secondary" type="button"
            disabled={!canSelectCustomer} onClick={onOpenCustomer}>
            {selectedCustomer ? 'Cambiar cliente' : 'Seleccionar cliente'}</button>
          {selectedCustomer && <button className="button button--secondary" type="button"
            onClick={() => controller.selectCustomer(null)}>Limpiar cliente</button>}
          {!canSelectCustomer && <small>Se requiere permiso para consultar clientes.</small>}
        </div>
        <label>Fecha desde<input type="date" value={filters.dateFrom}
          onChange={(event) => controller.setFilter('dateFrom', event.target.value)} /></label>
        <label>Fecha hasta<input type="date" value={filters.dateTo}
          onChange={(event) => controller.setFilter('dateTo', event.target.value)} /></label>
      </div>
      {controller.invalidDateRange && <p className="loan-list__message loan-list__message--error" role="alert">
        La fecha desde no puede ser posterior a la fecha hasta.</p>}
      {!controller.invalidDateRange && state.loading && <p className="loan-list__message" role="status">Cargando refinanciamientos…</p>}
      {!controller.invalidDateRange && state.error !== null && <div className="loan-list__message loan-list__message--error" role="alert">
        {loadError(state.error, 'list')}
        <button className="button button--secondary" type="button" onClick={() => { void controller.load(); }}>Reintentar</button>
      </div>}
      {!controller.invalidDateRange && !state.loading && state.error === null && data && !data.items.length &&
        <p className="loan-list__message"><strong>{data.total ? 'No hay refinanciamientos en esta página.' : hasFilters ?
          'No se encontraron refinanciamientos con los filtros seleccionados.' : 'No hay refinanciamientos registrados.'}</strong></p>}
      {!controller.invalidDateRange && !state.loading && state.error === null && data && data.items.length > 0 &&
        <div className="loan-list__table-wrap" role="region" aria-label="Operaciones de refinanciamiento" tabIndex={0}>
          <table className="loan-list__table"><caption className="loan-list__sr-only">Listado de refinanciamientos</caption>
            <thead><tr><th scope="col">Fecha</th><th scope="col">Cliente</th><th scope="col">Préstamo origen</th>
              <th scope="col" className="loan-list__numeric">Capital trasladado</th>
              <th scope="col" className="loan-list__numeric">Interés capitalizado</th>
              <th scope="col" className="loan-list__numeric">Dinero nuevo</th>
              <th scope="col" className="loan-list__numeric">Principal nuevo</th>
              <th scope="col" className="loan-list__numeric">Interés nuevo</th>
              <th scope="col" className="loan-list__numeric">Total nuevo</th>
              <th scope="col">Préstamo nuevo</th><th scope="col" className="loan-list__actions">Acciones</th></tr></thead>
            <tbody>{data.items.map((item) => <tr key={item.refinancingId}>
              <td>{formatDateOnlyForDisplay(item.refinancingDate)}</td>
              <td><strong>{item.customer.fullName}</strong><small>{item.customer.identification}</small></td>
              <td>#{item.originLoan.loanNumber}</td>
              {[item.outstandingPrincipalTransferred, item.capitalizedOutstandingInterest, item.newMoneyDisbursed,
                item.newContractualPrincipal, item.newInterestAmount, item.newContractualTotal].map((value, index) =>
                <td key={index} className="loan-list__numeric">{formatCRCAggregate(value)}</td>)}
              <td>#{item.newLoan.loanNumber}</td>
              <td className="loan-list__actions"><TableActions ariaLabel={`Acciones del refinanciamiento ${item.refinancingId}`} actions={[
                { key: 'detail', icon: 'view', label: 'Ver detalle', title: 'Ver detalle del refinanciamiento',
                  ariaLabel: `Ver detalle del refinanciamiento entre los préstamos ${item.originLoan.loanNumber} y ${item.newLoan.loanNumber}`,
                  to: `/loan-refinancings/${encodeURIComponent(item.refinancingId)}` },
                { key: 'chain', icon: 'route', label: 'Ver cadena', title: 'Ver cadena de refinanciamientos',
                  ariaLabel: `Ver cadena del préstamo origen ${item.originLoan.loanNumber}`,
                  to: `/loan-refinancings/chains/loan/${encodeURIComponent(item.originLoan.id)}` },
                ...(canViewLoans ? [
                  { key: 'origin', icon: 'payment' as const, label: 'Ver préstamo origen', title: 'Ver préstamo origen',
                    ariaLabel: `Ver préstamo origen ${item.originLoan.loanNumber}`, to: `/loans/${encodeURIComponent(item.originLoan.id)}` },
                  { key: 'successor', icon: 'payment' as const, label: 'Ver préstamo nuevo', title: 'Ver préstamo nuevo',
                    ariaLabel: `Ver préstamo nuevo ${item.newLoan.loanNumber}`, to: `/loans/${encodeURIComponent(item.newLoan.id)}` },
                ] : []),
              ]} /></td>
            </tr>)}</tbody>
          </table>
        </div>}
      {!controller.invalidDateRange && !state.loading && state.error === null && data &&
        <nav className="loan-list__pagination" aria-label="Páginas de refinanciamientos">
          <label>Por página <select value={state.pageSize}
            onChange={(event) => controller.setPageSize(Number(event.target.value) as RefinancingPageSize)}>
            {[10, 20, 50].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
          <span>Mostrando {start}-{end} de {data.total} refinanciamientos</span>
          <button className="button button--secondary" type="button" disabled={state.page <= 1}
            onClick={() => controller.setPage(state.page - 1)}>Anterior</button>
          <span>Página {state.page} de {Math.max(1, data.totalPages)}</span>
          <button className="button button--secondary" type="button" disabled={state.page >= data.totalPages}
            onClick={() => controller.setPage(state.page + 1)}>Siguiente</button>
        </nav>}
    </div>
    {customerOpen && canSelectCustomer && <div className="dialog-backdrop"><div className="dialog loan-customer-dialog" role="dialog"
      aria-modal="true" aria-labelledby="refinancing-client-title">
      <div className="loan-customer-dialog__header"><h2 id="refinancing-client-title">Seleccionar cliente</h2></div>
      <div className="loan-customer-dialog__search"><input ref={customerSearchRef} className="form-control" type="search"
        maxLength={120} aria-label="Buscar cliente" placeholder="Nombre o identificación" value={state.customerSearch}
        onChange={(event) => controller.setCustomerSearch(event.target.value)} /></div>
      {state.loadingCustomers && <p role="status" className="loan-list__message">Cargando clientes…</p>}
      {state.customerError !== null && <div role="alert" className="loan-list__message loan-list__message--error">
        {loadError(state.customerError, 'customers')}
        <button className="button button--secondary" type="button" onClick={() => { void controller.loadCustomers(); }}>Reintentar</button>
      </div>}
      {!state.loadingCustomers && state.customerError === null && state.customers && !state.customers.items.length &&
        <p className="loan-list__message">No se encontraron clientes.</p>}
      {!state.loadingCustomers && state.customerError === null && state.customers && state.customers.items.length > 0 &&
        <div className="catalog-table-wrap loan-customer-dialog__table-wrap" role="region"
          aria-label="Clientes disponibles para filtrar" tabIndex={0}>
          <table className="catalog-table loan-customer-table"><caption className="loan-list__sr-only">Seleccionar un cliente</caption>
            <thead><tr><th scope="col">Identificación</th><th scope="col">Nombre</th><th scope="col">Acción</th></tr></thead>
            <tbody>{state.customers.items.map((customer: RefinancingCustomerOption) => <tr key={customer.id}>
              <td>{customer.identification}</td><td>{customer.fullName}</td><td><TableActions actions={[
                { key: 'select', icon: 'view', label: 'Seleccionar', title: 'Seleccionar cliente',
                  ariaLabel: `Seleccionar cliente ${customer.fullName}`,
                  onClick: () => { controller.selectCustomer(customer); onCloseCustomer(); } },
              ]} /></td>
            </tr>)}</tbody></table>
        </div>}
      <div className="dialog-actions loan-customer-dialog__footer">
        <button className="button button--secondary" type="button" disabled={state.customerPage <= 1}
          onClick={() => controller.setCustomerPage(state.customerPage - 1)}>Anterior</button>
        <span>Página {state.customerPage} · {state.customers?.total ?? 0} clientes</span>
        <button className="button button--secondary" type="button"
          disabled={!state.customers || state.customerPage * 10 >= state.customers.total}
          onClick={() => controller.setCustomerPage(state.customerPage + 1)}>Siguiente</button>
        <button className="button button--secondary" type="button" onClick={onCloseCustomer}>Cerrar</button>
      </div>
    </div></div>}
  </section>;
}
