import { useEffect, useRef, useState, type ReactElement } from 'react';
import { cashMovementUseCases } from '../../app/cash-movements';
import { paymentMethodUseCases } from '../../app/payment-methods';
import { financialOpeningUseCases } from '../../app/financial-opening';
import { type CashMovement, type CashMovementFilters, type CashMovementSummary } from '../../domain/entities/cash-movement';
import { MANUAL_CONCEPTS } from '../../application/use-cases/cash-movement.use-cases';
import { collectAllCashMovements } from '../../application/use-cases/cash-movement-export';
import { formatCRC, normalizeMoney, signedCRC } from '../../shared/utils/money';
import { generateCashMovementExcel, generateCashMovementReport } from '../../infrastructure/reports/cash-movement-report.service';
import { TableActions } from '../components/TableActions';
import { MoneyInput } from '../components/MoneyInput';
import { Icon } from '../components/layout/Icon';
import { useAuth } from '../hooks/auth-context';
import { formatCashMovementTableConcept } from '../helpers/cash-movement-concept';
import { cashMovementFieldErrors, cashReversalFieldErrors, type CashMovementFieldErrors,
  type CashReversalFieldErrors } from '../helpers/cash-movement-validation';
import { HttpApiError } from '../../infrastructure/api/api-client';

type Form = {
  concept: (typeof MANUAL_CONCEPTS)[number]['value'];
  amount: string;
  movementDate: string;
  paymentMethodId: string;
  observations: string;
};
const initialForm: Form = {
  concept: 'CAPITAL_CONTRIBUTION',
  amount: '',
  movementDate: new Date().toISOString().slice(0, 10),
  paymentMethodId: '',
  observations: '',
};

export function CashMovementsPage(): ReactElement {
  const { can } = useAuth();
  const [items, setItems] = useState<CashMovement[]>([]);
  const [summary, setSummary] = useState<CashMovementSummary>({
    inflows: '0.00',
    outflows: '0.00',
    net: '0.00',
    currentAvailable: null,
    openingDate: null,
  });
  const [opening, setOpening] = useState(false);
  const [methods, setMethods] = useState<{ id: string; name: string; isActive: boolean }[]>([]);
  const [filters, setFilters] = useState({ fromDate: '', toDate: '', direction: '', concept: '', paymentMethodId: '', search: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<20 | 50 | 100>(20);
  const [form, setForm] = useState<Form>(initialForm);
  const [modal, setModal] = useState<'create' | 'reverse' | null>(null);
  const [selected, setSelected] = useState<CashMovement | null>(null);
  const [reverseDate, setReverseDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [movementFieldErrors, setMovementFieldErrors] = useState<CashMovementFieldErrors>({});
  const [reversalFieldErrors, setReversalFieldErrors] = useState<CashReversalFieldErrors>({});
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const exportingPdfRef = useRef(false);
  const exportingExcelRef = useRef(false);
  const operationRef = useRef(false);
  const load = async () => {
    try {
      const request: CashMovementFilters = {
        ...filters,
        direction: (filters.direction || undefined) as CashMovementFilters['direction'],
        concept: (filters.concept || undefined) as CashMovementFilters['concept'],
        page,
        pageSize,
      };
      const [list, totals] = await Promise.all([
        cashMovementUseCases.list.execute(request),
        cashMovementUseCases.summary.execute({ ...request }),
      ]);
      setItems(list.items);
      setSummary(totals);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No fue posible cargar los movimientos.');
    }
  };
  useEffect(() => {
    void Promise.all([
      financialOpeningUseCases.get.execute().then((value) => setOpening(value.configured)),
      paymentMethodUseCases.list.execute().then(setMethods),
    ]);
  }, []);
  useEffect(() => {
    void load();
  }, [filters, page, pageSize]);
  const manual = MANUAL_CONCEPTS.find((item) => item.value === form.concept)!;
  const submit = async () => {
    if (operationRef.current) return;
    const errors = cashMovementFieldErrors(form, methods);
    setMovementFieldErrors(errors);
    if (Object.keys(errors).length) {
      setError(null);
      return;
    }
    operationRef.current = true;
    setSaving(true);
    try {
      setError(null);
      await cashMovementUseCases.create.execute({
        ...form,
        amount: normalizeMoney(form.amount),
        observations: form.observations.trim() || undefined,
      });
      setModal(null);
      setForm(initialForm);
      setMovementFieldErrors({});
      await load();
    } catch (e) {
      if (e instanceof HttpApiError && e.fieldErrors.length) {
        setMovementFieldErrors(Object.fromEntries(e.fieldErrors.map((item) => [item.field, item.message])) as CashMovementFieldErrors);
        setError(null);
      } else setError(e instanceof Error ? e.message : 'No fue posible registrar el movimiento.');
    } finally { operationRef.current = false; setSaving(false); }
  };
  const reverse = async () => {
    if (!selected || operationRef.current) return;
    const validation = cashReversalFieldErrors(reverseDate, reason, selected.movementDate);
    setReversalFieldErrors(validation);
    if (Object.keys(validation).length) {
      setError(null);
      return;
    }
    operationRef.current = true;
    setSaving(true);
    try {
      setError(null);
      await cashMovementUseCases.reverse.execute(selected.id, { movementDate: reverseDate, reason: reason.trim() });
      setModal(null);
      setSelected(null);
      setReason('');
      setReversalFieldErrors({});
      await load();
    } catch (e) {
      if (e instanceof HttpApiError && e.fieldErrors.length) {
        setReversalFieldErrors(Object.fromEntries(e.fieldErrors.map((item) => [item.field, item.message])) as CashReversalFieldErrors);
        setError(null);
      } else setError(e instanceof Error ? e.message : 'No fue posible reversar el movimiento.');
    } finally { operationRef.current = false; setSaving(false); }
  };
  const exportMovements = async (format: 'PDF' | 'Excel') => {
    const lock = format === 'PDF' ? exportingPdfRef : exportingExcelRef;
    if (lock.current) return;
    lock.current = true;
    const setExporting = format === 'PDF' ? setExportingPdf : setExportingExcel;
    setExporting(true);
    setError(null);
    try {
      const exportFilters: Omit<CashMovementFilters, 'page' | 'pageSize'> = {
        ...filters,
        direction: (filters.direction || undefined) as CashMovementFilters['direction'],
        concept: (filters.concept || undefined) as CashMovementFilters['concept'],
      };
      const all = await collectAllCashMovements({ list: (request) => cashMovementUseCases.list.execute(request) }, exportFilters);
      if (format === 'PDF') await generateCashMovementReport(all, summary, filters.fromDate, filters.toDate);
      else await generateCashMovementExcel(all, summary, filters.fromDate, filters.toDate);
    } catch {
      setError(`No fue posible exportar los movimientos a ${format}.`);
    } finally {
      lock.current = false;
      setExporting(false);
    }
  };
  return (
    <section className="payment-page cash-movements-page">
      <div className="payment-heading">
        <div>
          <span className="page-eyebrow">FINANZAS</span>
          <h2>Movimientos de caja</h2>
          <p>Consulta las entradas y salidas reales de dinero.</p>
        </div>
        <div className="payment-actions">
          {can('cash-movements.create') && opening && (
            <button className="button button--primary" type="button" onClick={() => { setError(null); setMovementFieldErrors({}); setModal('create'); }}>
              Nuevo movimiento
            </button>
          )}
          {can('cash-movements.export') && (
            <>
              <button
                className="button button--secondary"
                type="button"
                disabled={exportingPdf}
                aria-busy={exportingPdf}
                onClick={() => void exportMovements('PDF')}
              >
                {exportingPdf ? 'Exportando…' : 'Exportar PDF'}
              </button>
              <button
                className="button button--secondary"
                type="button"
                disabled={exportingExcel}
                aria-busy={exportingExcel}
                onClick={() => void exportMovements('Excel')}
              >
                <Icon name="download" />
                {exportingExcel ? 'Exportando…' : 'Exportar Excel'}
              </button>
            </>
          )}
        </div>
      </div>
      {!opening && <div className="catalog-message">Apertura financiera pendiente.</div>}
      {error && !modal && (
        <div className="catalog-message catalog-message--error" role="alert">
          {error}
        </div>
      )}
      <div className="cash-summary">
        <div>
          <span>Disponible actual</span>
          <strong>{summary.currentAvailable === null ? '—' : formatCRC(summary.currentAvailable)}</strong>
        </div>
        <div>
          <span>Entradas del período</span>
          <strong>{formatCRC(summary.inflows)}</strong>
        </div>
        <div>
          <span>Salidas del período</span>
          <strong>{formatCRC(summary.outflows)}</strong>
        </div>
        <div>
          <span>Neto del período</span>
          <strong>{formatCRC(summary.net)}</strong>
        </div>
      </div>
      <div className="payment-toolbar">
        <label>
          Desde
          <input type="date" value={filters.fromDate} onChange={(e) => setFilters({ ...filters, fromDate: e.target.value })} />
        </label>
        <label>
          Hasta
          <input type="date" value={filters.toDate} onChange={(e) => setFilters({ ...filters, toDate: e.target.value })} />
        </label>
        <label>
          Tipo
          <select value={filters.direction} onChange={(e) => setFilters({ ...filters, direction: e.target.value })}>
            <option value="">Todos</option>
            <option value="INFLOW">Entradas</option>
            <option value="OUTFLOW">Salidas</option>
          </select>
        </label>
        <label>
          Concepto
          <select value={filters.concept} onChange={(e) => setFilters({ ...filters, concept: e.target.value })}>
            <option value="">Todos</option>
            {MANUAL_CONCEPTS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Forma de pago
          <select value={filters.paymentMethodId} onChange={(e) => setFilters({ ...filters, paymentMethodId: e.target.value })}>
            <option value="">Todas</option>
            {methods.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="catalog-table-wrap">
        <table className="catalog-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tipo</th>
              <th>Concepto</th>
              <th>Forma de pago</th>
              <th>Monto</th>
              <th>Registrado por</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.movementDate}</td>
                <td>{item.direction === 'INFLOW' ? 'Entrada' : 'Salida'}</td>
                <td>
                  <span>{formatCashMovementTableConcept(item)}</span>
                </td>
                <td>{item.paymentMethod.name}</td>
                <td>
                  <span className={`cash-movement-amount cash-movement-amount--${item.direction === 'INFLOW' ? 'inflow' : 'outflow'}`}>
                    {signedCRC(item.amount, item.direction)}
                  </span>
                </td>
                <td>{item.createdBy.fullName}</td>
                <td>
                  <TableActions
                    actions={
                      can('cash-movements.reverse') && !item.reversedMovementId && MANUAL_CONCEPTS.some((c) => c.value === item.concept)
                        ? [
                            {
                              key: 'reverse',
                              icon: 'reverse',
                              label: 'Reversar movimiento',
                              title: 'Reversar movimiento',
                              ariaLabel: 'Reversar movimiento',
                              onClick: () => {
                                setSelected(item);
                                setReverseDate(new Date().toISOString().slice(0, 10));
                                setError(null);
                                setReversalFieldErrors({});
                                setModal('reverse');
                              },
                            },
                          ]
                        : []
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pagination-controls">
        <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Anterior
        </button>
        <span>Página {page}</span>
        <button type="button" disabled={items.length < pageSize} onClick={() => setPage(page + 1)}>
          Siguiente
        </button>
        <select
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value) as 20 | 50 | 100);
            setPage(1);
          }}
        >
          <option value="20">20</option>
          <option value="50">50</option>
          <option value="100">100</option>
        </select>
      </div>
      {modal === 'create' && (
        <div className="dialog-backdrop">
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="cash-movement-create-title">
            <h3 id="cash-movement-create-title">Nuevo movimiento</h3>
            <label>
              Concepto
              <select value={form.concept} onChange={(e) => setForm({ ...form, concept: e.target.value as Form['concept'] })}>
                {MANUAL_CONCEPTS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <p>Tipo: {manual.direction === 'INFLOW' ? 'Entrada' : 'Salida'}</p>
            <label>
              Importe
              <MoneyInput id="cash-movement-amount" value={form.amount} aria-invalid={Boolean(movementFieldErrors.amount)}
                aria-describedby={movementFieldErrors.amount ? 'cash-movement-amount-error' : undefined}
                onChange={(amount) => { setForm({ ...form, amount }); setMovementFieldErrors((current) => ({ ...current, amount: undefined })); }} />
              {movementFieldErrors.amount && <span id="cash-movement-amount-error" className="form-error">{movementFieldErrors.amount}</span>}
            </label>
            <label>
              Fecha
              <input id="cash-movement-date" type="date" value={form.movementDate} aria-invalid={Boolean(movementFieldErrors.movementDate)}
                aria-describedby={movementFieldErrors.movementDate ? 'cash-movement-date-error' : undefined}
                onChange={(e) => { setForm({ ...form, movementDate: e.target.value }); setMovementFieldErrors((current) => ({ ...current, movementDate: undefined })); }} />
              {movementFieldErrors.movementDate && <span id="cash-movement-date-error" className="form-error">{movementFieldErrors.movementDate}</span>}
            </label>
            <label>
              Forma de pago
              <select id="cash-movement-payment-method" value={form.paymentMethodId} aria-invalid={Boolean(movementFieldErrors.paymentMethodId)}
                aria-describedby={movementFieldErrors.paymentMethodId ? 'cash-movement-payment-method-error' : undefined}
                onChange={(e) => { setForm({ ...form, paymentMethodId: e.target.value }); setMovementFieldErrors((current) => ({ ...current, paymentMethodId: undefined })); }}>
                <option value="">Seleccione</option>
                {methods
                  .filter((m) => m.isActive)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
              {movementFieldErrors.paymentMethodId && <span id="cash-movement-payment-method-error" className="form-error">{movementFieldErrors.paymentMethodId}</span>}
            </label>
            <label>
              Observaciones
              <textarea value={form.observations} onChange={(e) => setForm({ ...form, observations: e.target.value })} />
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="dialog-actions">
              <button className="button button--secondary" type="button" disabled={saving} onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button className="button button--primary" type="button" disabled={saving} aria-busy={saving} onClick={() => void submit()}>
                {saving ? 'Registrando…' : 'Registrar movimiento'}
              </button>
            </div>
          </div>
        </div>
      )}
      {modal === 'reverse' && selected && (
        <div className="dialog-backdrop">
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="cash-reversal-title">
            <h3 id="cash-reversal-title">Reversar movimiento</h3>
            <p>
              {selected.movementDate} · {selected.paymentMethod.name} · {signedCRC(selected.amount, selected.direction)}
            </p>
            <label>
              Fecha de reversión
              <input id="cash-reversal-date" type="date" value={reverseDate} aria-invalid={Boolean(reversalFieldErrors.movementDate)}
                aria-describedby={reversalFieldErrors.movementDate ? 'cash-reversal-date-error' : undefined}
                onChange={(e) => { setReverseDate(e.target.value); setReversalFieldErrors((current) => ({ ...current, movementDate: undefined })); }} />
              {reversalFieldErrors.movementDate && <span id="cash-reversal-date-error" className="form-error">{reversalFieldErrors.movementDate}</span>}
            </label>
            <label>
              Razón
              <textarea id="cash-reversal-reason" required value={reason} aria-invalid={Boolean(reversalFieldErrors.reason)}
                aria-describedby={reversalFieldErrors.reason ? 'cash-reversal-reason-error' : undefined}
                onChange={(e) => { setReason(e.target.value); setReversalFieldErrors((current) => ({ ...current, reason: undefined })); }} />
              {reversalFieldErrors.reason && <span id="cash-reversal-reason-error" className="form-error">{reversalFieldErrors.reason}</span>}
            </label>
            <p>¿Confirmás la reversión de este movimiento?</p>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="dialog-actions">
              <button className="button button--secondary" type="button" disabled={saving} onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button className="button button--primary" type="button" disabled={!reason.trim() || saving} aria-busy={saving} onClick={() => void reverse()}>
                {saving ? 'Confirmando…' : 'Confirmar reversión'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
