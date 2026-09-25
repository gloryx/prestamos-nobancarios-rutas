import { useEffect, useState, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { customerUseCases } from '../../app/customers';
import type { CustomerListItem, CustomerSummary } from '../../domain/entities/customer';
import { generateCustomerReport as createCustomerReport } from '../../infrastructure/reports/customer-report.service';
import { generateCustomerFileReport } from '../../infrastructure/reports/customer-file-report.service';
import { Icon } from '../components/layout/Icon';
import { useAuth } from '../hooks/auth-context';

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
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [changing, setChanging] = useState('');
  const [confirming, setConfirming] = useState<CustomerListItem | null>(null);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const list = await customerUseCases.list.execute({ search, status, page, pageSize });
      setItems(list.items); setTotal(list.total); setTotalPages(list.totalPages);
      if (can('customers.summary.view')) setSummary(await customerUseCases.summary.execute());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los clientes.');
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [page, pageSize, status]);

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
    {can('customers.summary.view') && <div className="customer-summary-cards"><Summary label="Total de clientes" value={summary?.totalCustomers} /><Summary label="Masculino" value={summary?.maleCustomers} /><Summary label="Femenino" value={summary?.femaleCustomers} /><Summary label="Con préstamo activo" value={summary?.activeLoans ?? '—'} /></div>}
    <div className="customer-toolbar"><label>Buscar<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Identificación, nombre, teléfono o dirección" onKeyDown={(event) => { if (event.key === 'Enter') { setPage(1); void load(); } }} /></label><label>Estado<select value={status} onChange={(event) => { setStatus(event.target.value as Status); setPage(1); }}><option value="ACTIVE">Activos</option><option value="INACTIVE">Inactivos</option><option value="ALL">Todos</option></select></label><button className="button button--secondary" type="button" onClick={() => { setPage(1); void load(); }}>Buscar</button>{can('customers.export') && <button className="button button--secondary" type="button" disabled={loading || !total} onClick={() => void createCustomerReport({ search, status })}>Exportar PDF</button>}</div>
    {error && <div className="catalog-message catalog-message--error" role="alert">{error}</div>}{loading && <div className="catalog-message">Cargando clientes…</div>}
    {!loading && !error && !items.length && <div className="catalog-message"><strong>No hay clientes registrados.</strong>{can('customers.create') && <><br /><Link className="button button--primary" to="/customers/new">Nuevo cliente</Link></>}</div>}
    {!loading && !error && items.length > 0 && <><div className="catalog-table-wrap"><table className="catalog-table customer-table"><thead><tr><th>Identificación</th><th>Cliente</th><th>Teléfono</th><th>Dirección</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{item.identification}</td><td>{item.fullName}</td><td>{item.primaryPhone}</td><td>{item.address}</td><td><span className={`status-badge ${item.isActive ? 'status-badge--active' : 'status-badge--inactive'}`}>{item.isActive ? 'Activo' : 'Inactivo'}</span></td><td><CustomerActions customer={item} can={can} canAll={canAll} navigate={navigate} onStatus={() => setConfirming(item)} onDownload={() => void downloadFile(item.id)} /></td></tr>)}</tbody></table></div><div className="customer-pagination"><button className="button button--secondary" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {page} de {totalPages || 1} · {total} clientes</span><button className="button button--secondary" type="button" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Siguiente</button><label>Mostrar<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value="10">10</option><option value="20">20</option><option value="50">50</option></select></label></div></>}
  </section>;
}

function CustomerActions({ customer, can, canAll, navigate, onStatus, onDownload }: { customer: CustomerListItem; can: (code: string) => boolean; canAll: (codes: string[]) => boolean; navigate: (path: string) => void; onStatus: () => void; onDownload: () => void }): ReactElement {
  return <div className="icon-actions" aria-label={`Acciones de ${customer.fullName}`}>
    {can('customers.view') && <button type="button" title="Ver información" aria-label="Ver información" onClick={() => navigate(`/customers/${customer.id}`)}><Icon name="view" /></button>}
    {can('customers.update') && <button type="button" title="Editar cliente" aria-label="Editar cliente" onClick={() => navigate(`/customers/${customer.id}/edit`)}><Icon name="edit" /></button>}
    <button type="button" disabled title="Disponible próximamente" aria-label="Disponible próximamente"><Icon name="payment" /></button>
    {canAll(['customers.export', 'customers.files.view']) && <button type="button" title="Descargar expediente" aria-label="Descargar expediente" onClick={onDownload}><Icon name="download" /></button>}
    {can('customers.status.change') && <button type="button" title={customer.isActive ? 'Inactivar cliente' : 'Activar cliente'} aria-label={customer.isActive ? 'Inactivar cliente' : 'Activar cliente'} onClick={onStatus}><Icon name={customer.isActive ? 'lock' : 'unlock'} /></button>}
  </div>;
}

function Summary({ label, value }: { label: string; value?: string | number }): ReactElement { return <div className="customer-summary-card"><span>{label}</span><strong>{value ?? '—'}</strong></div>; }
function CustomerStatusDialog({ customer, busy, onCancel, onConfirm }: { customer: CustomerListItem; busy: boolean; onCancel: () => void; onConfirm: () => void }): ReactElement { const action = customer.isActive ? 'inactivar' : 'activar'; return <div className="dialog-backdrop"><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="customer-status-title"><h3 id="customer-status-title">Confirmar {action} cliente</h3><p>¿Deseás {action} a <strong>{customer.fullName}</strong>?</p><div className="dialog-actions"><button className="button button--secondary" type="button" disabled={busy} onClick={onCancel}>Cancelar</button><button className="button button--primary" type="button" disabled={busy} onClick={onConfirm}>{busy ? 'Guardando…' : `Sí, ${action}`}</button></div></div></div>; }
