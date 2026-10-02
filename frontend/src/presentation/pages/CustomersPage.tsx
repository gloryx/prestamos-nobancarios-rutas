import { useEffect, useState, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { customerUseCases } from '../../app/customers';
import type { CustomerListItem, CustomerSummary } from '../../domain/entities/customer';
import { generateCustomerReport as createCustomerReport } from '../../infrastructure/reports/customer-report.service';
import { generateCustomerFileReport } from '../../infrastructure/reports/customer-file-report.service';
import { TableActions } from '../components/TableActions';
import { customerActionDefinitions, visibleTableActions } from '../helpers/table-action-definitions';
import { useAuth } from '../hooks/auth-context';
import { Icon } from '../components/layout/Icon';
import type { CustomerSortBy, CustomerSortOrder } from '../../application/ports/customer.repository';

type Status = 'ACTIVE' | 'INACTIVE' | 'ALL';

export function CustomersPage(): ReactElement {
  const navigate = useNavigate();
  const { can, canAll } = useAuth();
  const [items, setItems] = useState<CustomerListItem[]>([]);
  const [summary, setSummary] = useState<CustomerSummary>();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Status>('ACTIVE');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortBy, setSortBy] = useState<CustomerSortBy>();
  const [sortOrder, setSortOrder] = useState<CustomerSortOrder>();
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [changing, setChanging] = useState('');
  const [confirming, setConfirming] = useState<CustomerListItem | null>(null);

  const load = async () => {
    setLoading(true); setError(''); setSummary(undefined);
    try {
      const list = await customerUseCases.list.execute({ search, status, page, pageSize, sortBy, sortOrder });
      setItems(list.items); setTotal(list.total); setTotalPages(list.totalPages);
      if (can('customers.summary.view')) setSummary(await customerUseCases.summary.execute({ search, status }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los clientes.');
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [page, pageSize, status, sortBy, sortOrder]);

  const changeSort = (column: CustomerSortBy) => {
    setPage(1);
    if (sortBy !== column) { setSortBy(column); setSortOrder('asc'); return; }
    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
  };

  const changeStatus = async () => {
    if (!confirming || !can('customers.status.change')) return;
    setChanging(confirming.id);
    try { await customerUseCases.changeStatus.execute(confirming.id, !confirming.isActive); setConfirming(null); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cambiar el estado.'); }
    finally { setChanging(''); }
  };

  const downloadFile = async (customerId: string) => {
    if (!canAll(['customers.export', 'customers.files.view'])) return;
    try {
      const detail = await customerUseCases.get.execute(customerId);
      await generateCustomerFileReport(detail, (id, kind) => customerUseCases.file.execute(id, kind));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo descargar el expediente.');
    }
  };

  if (confirming) return <CustomerStatusDialog customer={confirming} busy={changing === confirming.id} onCancel={() => setConfirming(null)} onConfirm={() => void changeStatus()} />;
  return <section className="customer-admin" aria-labelledby="customer-title">
    <div className="customer-admin__heading"><div><p className="eyebrow">GESTIÓN</p><h2 id="customer-title">Clientes</h2></div>{can('customers.create') && <Link className="button button--primary" to="/customers/new">Nuevo cliente</Link>}</div>
    {can('customers.summary.view') && <div className="customer-summary-cards"><Summary label="Total de clientes" value={summary?.totalCustomers} /><Summary label="Masculino" value={summary?.maleCustomers} /><Summary label="Femenino" value={summary?.femaleCustomers} /><Summary label="Con préstamos activos" value={summary?.customersWithActiveLoans} /></div>}
     <div className="customer-toolbar"><label>Buscar<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Identificación, nombre, teléfono o dirección" onKeyDown={(event) => { if (event.key === 'Enter') { setPage(1); void load(); } }} /></label><label>Estado<select value={status} onChange={(event) => { setStatus(event.target.value as Status); setPage(1); }}><option value="ACTIVE">Activos</option><option value="INACTIVE">Inactivos</option><option value="ALL">Todos</option></select></label><button className="button button--secondary" type="button" onClick={() => { setPage(1); void load(); }}>Buscar</button>{can('customers.export') && <button className="button button--secondary" type="button" disabled={loading || !total} onClick={() => void createCustomerReport({ search, status, sortBy, sortOrder })}>Exportar PDF</button>}</div>
    {error && <div className="catalog-message catalog-message--error" role="alert">{error}</div>}{loading && <div className="catalog-message">Cargando clientes…</div>}
     {!loading && !error && !items.length && <div className="catalog-message customer-admin__empty-state"><strong>No hay clientes registrados.</strong>{can('customers.create') && <Link className="button button--primary" to="/customers/new">Nuevo cliente</Link>}</div>}
     {!loading && !error && items.length > 0 && <><div className="catalog-table-wrap"><table className="catalog-table customer-table"><thead><tr><SortableHeader column="identification" label="Identificación" sortBy={sortBy} sortOrder={sortOrder} onSort={changeSort} /><SortableHeader column="name" label="Cliente" sortBy={sortBy} sortOrder={sortOrder} onSort={changeSort} /><SortableHeader column="phone" label="Teléfono" sortBy={sortBy} sortOrder={sortOrder} onSort={changeSort} /><SortableHeader column="address" label="Dirección" sortBy={sortBy} sortOrder={sortOrder} onSort={changeSort} /><SortableHeader column="status" label="Estado" sortBy={sortBy} sortOrder={sortOrder} onSort={changeSort} /><th>Acciones</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{item.identification}</td><td>{item.fullName}</td><td>{item.primaryPhone}</td><td>{item.address}</td><td><span className={`status-badge ${item.isActive ? 'status-badge--active' : 'status-badge--inactive'}`}>{item.isActive ? 'Activo' : 'Inactivo'}</span></td><td><CustomerActions customer={item} can={can} canAll={canAll} navigate={navigate} onStatus={() => setConfirming(item)} onDownload={() => void downloadFile(item.id)} /></td></tr>)}</tbody></table></div><div className="customer-pagination"><button className="button button--secondary" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {page} de {totalPages || 1} · {total} clientes</span><button className="button button--secondary" type="button" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Siguiente</button><label>Mostrar<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value="10">10</option><option value="20">20</option><option value="50">50</option></select></label></div></>}
  </section>;
}

function SortableHeader({ column, label, sortBy, sortOrder, onSort }: { column: CustomerSortBy; label: string; sortBy?: CustomerSortBy; sortOrder?: CustomerSortOrder; onSort: (column: CustomerSortBy) => void }): ReactElement {
  const active = sortBy === column;
  const nextOrder = active && sortOrder === 'asc' ? 'desc' : 'asc';
  return <th aria-sort={active ? sortOrder === 'asc' ? 'ascending' : 'descending' : 'none'}><button className="customer-sort-button" type="button" onClick={() => onSort(column)} aria-label={`${label}: ordenar ${nextOrder === 'asc' ? 'ascendente' : 'descendente'}`}><span>{label}</span><Icon name={active ? sortOrder === 'asc' ? 'sort-asc' : 'sort-desc' : 'sort'} /></button></th>;
}

function CustomerActions({ customer, can, canAll, navigate, onStatus, onDownload }: { customer: CustomerListItem; can: (code: string) => boolean; canAll: (codes: string[]) => boolean; navigate: (path: string) => void; onStatus: () => void; onDownload: () => void }): ReactElement {
  const actions = visibleTableActions(customerActionDefinitions(customer.isActive), can, canAll).map((action) => ({ ...action, onClick: action.key === 'view' ? () => navigate(`/customers/${customer.id}`) : action.key === 'edit' ? () => navigate(`/customers/${customer.id}/edit`) : action.key === 'download' ? onDownload : action.key === 'status' ? onStatus : undefined }));
  return <TableActions actions={actions} ariaLabel={`Acciones de ${customer.fullName}`} />;
}

function Summary({ label, value }: { label: string; value?: string | number }): ReactElement { return <div className="customer-summary-card"><span>{label}</span><strong>{value ?? '—'}</strong></div>; }
function CustomerStatusDialog({ customer, busy, onCancel, onConfirm }: { customer: CustomerListItem; busy: boolean; onCancel: () => void; onConfirm: () => void }): ReactElement { const action = customer.isActive ? 'inactivar' : 'activar'; return <div className="dialog-backdrop"><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="customer-status-title"><h3 id="customer-status-title">Confirmar {action} cliente</h3><p>¿Deseás {action} a <strong>{customer.fullName}</strong>?</p><div className="dialog-actions"><button className="button button--secondary" type="button" disabled={busy} onClick={onCancel}>Cancelar</button><button className="button button--primary" type="button" disabled={busy} onClick={onConfirm}>{busy ? 'Guardando…' : `Sí, ${action}`}</button></div></div></div>; }
