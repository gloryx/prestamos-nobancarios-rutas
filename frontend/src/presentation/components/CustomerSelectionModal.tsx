import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import { createCustomerSelection } from '../../app/customer-selection';
import { CustomerSelectionController, type CustomerSelectionState } from '../../application/use-cases/customer-selection-controller';
import type { CustomerListItem } from '../../domain/entities/customer';

const loadError = (error: unknown): string => {
  if (typeof error === 'object' && error !== null && 'status' in error && error.status === 403)
    return 'No tienes permiso para consultar clientes.';
  if (error instanceof TypeError) return 'No se pudo conectar al servidor. Intenta nuevamente.';
  return 'No se pudieron cargar los clientes. Intenta nuevamente.';
};

export function CustomerSelectionModal({ onClose, onSelect, canListCustomers, controller: supplied }: {
  onClose: () => void;
  onSelect: (customer: CustomerListItem) => void;
  canListCustomers: boolean;
  controller?: CustomerSelectionController;
}): ReactElement {
  const [controller] = useState(() => supplied ?? createCustomerSelection());
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const previousSearch = useRef(state.search);
  const searchRef = useRef<HTMLInputElement>(null);
  const selectionLocked = useRef(false);
  const [selectingId, setSelectingId] = useState<string | null>(null);

  useEffect(() => {
    if (!canListCustomers) return;
    const delay = previousSearch.current !== state.search && state.search.trim() ? 250 : 0;
    previousSearch.current = state.search;
    const timer = window.setTimeout(() => { void controller.load(); }, delay);
    return () => window.clearTimeout(timer);
  }, [canListCustomers, controller, state.page, state.search]);

  useEffect(() => {
    searchRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !selectionLocked.current) {
        controller.close();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [controller, onClose]);

  useEffect(() => () => { if (!supplied) controller.dispose(); }, [controller, supplied]);

  const close = () => {
    if (selectionLocked.current) return;
    controller.close();
    onClose();
  };
  const select = (customer: CustomerListItem) => {
    if (selectionLocked.current) return;
    selectionLocked.current = true;
    setSelectingId(customer.id);
    onClose();
    onSelect(customer);
  };

  return <CustomerSelectionModalView state={state} controller={controller} canListCustomers={canListCustomers}
    selectingId={selectingId} onClose={close} onSelect={select} searchRef={searchRef} />;
}

export function CustomerSelectionModalView({ state, controller, canListCustomers, selectingId, onClose, onSelect, searchRef }: {
  state: CustomerSelectionState;
  controller: CustomerSelectionController;
  canListCustomers: boolean;
  selectingId: string | null;
  onClose: () => void;
  onSelect: (customer: CustomerListItem) => void;
  searchRef?: React.RefObject<HTMLInputElement | null>;
}): ReactElement {
  const start = state.data?.items.length ? (state.data.page - 1) * state.data.pageSize + 1 : 0;
  const end = state.data?.items.length ? start + state.data.items.length - 1 : 0;
  return <div className="dialog-backdrop"><div className="dialog loan-customer-dialog customer-selection-dialog" role="dialog"
    aria-modal="true" aria-labelledby="customer-selection-title">
    <div className="loan-customer-dialog__header"><h2 id="customer-selection-title">Seleccionar cliente</h2></div>
    <div className="loan-customer-dialog__search"><input ref={searchRef} className="form-control" type="search"
      maxLength={120} aria-label="Buscar cliente" placeholder="Nombre, identificación o teléfono" value={state.search}
      disabled={!canListCustomers || selectingId !== null} onChange={(event) => controller.setSearch(event.target.value)} /></div>
    {!canListCustomers && <p className="loan-list__message loan-list__message--error" role="alert">
      Necesitás el permiso customers.view para consultar el listado de clientes.</p>}
    {canListCustomers && state.loading && <p className="loan-list__message" role="status">Cargando clientes…</p>}
    {canListCustomers && state.error !== null && <div className="loan-list__message loan-list__message--error" role="alert">
      {loadError(state.error)}
      <button className="button button--secondary" type="button" onClick={() => { void controller.load(); }}>Reintentar</button>
    </div>}
    {canListCustomers && !state.loading && state.error === null && state.data && !state.data.items.length &&
      <p className="loan-list__message">{state.search.trim()
        ? 'No se encontraron clientes para la búsqueda.' : 'No hay clientes disponibles.'}</p>}
    {canListCustomers && !state.loading && state.error === null && state.data && state.data.items.length > 0 &&
      <div className="catalog-table-wrap loan-customer-dialog__table-wrap" role="region"
        aria-label="Clientes disponibles para análisis financiero" tabIndex={0}>
        <table className="catalog-table loan-customer-table customer-selection-table">
          <caption className="loan-list__sr-only">Seleccionar un cliente</caption>
          <thead><tr><th scope="col">Identificación</th><th scope="col">Nombre</th><th scope="col">Teléfono</th><th scope="col">Acción</th></tr></thead>
          <tbody>{state.data.items.map((customer) => <tr key={customer.id}>
            <td data-label="Identificación">{customer.identification}</td>
            <td data-label="Nombre">{customer.fullName}</td>
            <td data-label="Teléfono">{customer.primaryPhone || 'Sin teléfono'}</td>
            <td data-label="Acción"><button className="button button--secondary" type="button"
              aria-label={`Seleccionar cliente ${customer.fullName}`} disabled={selectingId !== null}
              onClick={() => onSelect(customer)}>{selectingId === customer.id ? 'Seleccionando…' : 'Seleccionar'}</button></td>
          </tr>)}</tbody>
        </table>
      </div>}
    <div className="dialog-actions loan-customer-dialog__footer customer-selection-dialog__footer">
      {canListCustomers && <>
        <button className="button button--secondary" type="button" disabled={state.page <= 1 || state.loading || selectingId !== null}
          onClick={() => controller.setPage(state.page - 1)}>Anterior</button>
        <span aria-live="polite">{state.data ? `${start}–${end} de ${state.data.total}` : '0–0 de 0'}</span>
        <button className="button button--secondary" type="button"
          disabled={!state.data || state.page >= state.data.totalPages || state.loading || selectingId !== null}
          onClick={() => controller.setPage(state.page + 1)}>Siguiente</button>
      </>}
      <button className="button button--secondary" type="button" disabled={selectingId !== null} onClick={onClose}>Cancelar</button>
    </div>
  </div></div>;
}
