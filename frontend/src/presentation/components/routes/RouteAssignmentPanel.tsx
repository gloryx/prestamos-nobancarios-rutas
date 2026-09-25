import { useEffect, useState, type ReactElement } from 'react';
import { routeUseCases } from '../../../app/routes';
import type { RouteAssignmentOptions } from '../../../domain/entities/route-assignment';
import { useAuth } from '../../hooks/auth-context';

const emptyOptions: RouteAssignmentOptions = { customers: [], routes: [], collectors: [] };

export function RouteAssignmentPanel(): ReactElement | null {
  const { can } = useAuth();
  const canAssignCustomers = can('routes.assign.customers');
  const canAssignCollectors = can('routes.assign.collectors');
  const [options, setOptions] = useState(emptyOptions);
  const [routeId, setRouteId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [collectorUserId, setCollectorUserId] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canAssignCustomers && !canAssignCollectors) return;
    setLoading(true);
    void routeUseCases.assignmentOptions.execute().then((result) => {
      setOptions(result);
      setRouteId(result.routes[0]?.id ?? '');
      setCustomerId(result.customers[0]?.id ?? '');
      setCollectorUserId(result.collectors[0]?.id ?? '');
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'No fue posible cargar las opciones de asignación.')).finally(() => setLoading(false));
  }, [canAssignCustomers, canAssignCollectors]);

  if (!canAssignCustomers && !canAssignCollectors) return null;
  const assignCustomer = async () => {
    if (!routeId || !customerId || !canAssignCustomers) return;
    setSaving(true); setError(null); setMessage(null);
    try { await routeUseCases.assignCustomer.execute({ customerId, routeId }); setMessage('Cliente asignado a la ruta.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No fue posible asignar el cliente.'); }
    finally { setSaving(false); }
  };
  const assignCollector = async () => {
    if (!routeId || !collectorUserId || !canAssignCollectors) return;
    setSaving(true); setError(null); setMessage(null);
    try { await routeUseCases.assignCollector.execute({ collectorUserId, routeId }); setMessage('Cobrador asignado a la ruta.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No fue posible asignar el cobrador.'); }
    finally { setSaving(false); }
  };

  return <section className="payment-page" aria-labelledby="assignment-title"><div className="payment-heading"><div><p className="eyebrow">OPERACIÓN</p><h3 id="assignment-title">Asignaciones</h3><p>Asigna clientes y cobradores a rutas activas.</p></div></div>{loading && <div className="catalog-message">Cargando opciones…</div>}{error && <div className="catalog-message catalog-message--error" role="alert">{error}</div>}{message && <div className="success-message" role="status">{message}</div>}<div className="payment-toolbar"><label>Ruta activa<select value={routeId} onChange={(event) => setRouteId(event.target.value)} disabled={loading || saving}><option value="">Selecciona una ruta</option>{options.routes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}</select></label>{canAssignCustomers && <><label>Cliente activo<select value={customerId} onChange={(event) => setCustomerId(event.target.value)} disabled={loading || saving}><option value="">Selecciona un cliente</option>{options.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.fullName} · {customer.identification}</option>)}</select></label><button className="button button--secondary" type="button" onClick={() => void assignCustomer()} disabled={saving || !routeId || !customerId}>Asignar cliente</button></>}{canAssignCollectors && <><label>Cobrador activo<select value={collectorUserId} onChange={(event) => setCollectorUserId(event.target.value)} disabled={loading || saving}><option value="">Selecciona un cobrador</option>{options.collectors.map((collector) => <option key={collector.id} value={collector.id}>{collector.fullName} · {collector.username}</option>)}</select></label><button className="button button--secondary" type="button" onClick={() => void assignCollector()} disabled={saving || !routeId || !collectorUserId}>Asignar cobrador</button></>}</div></section>;
}
