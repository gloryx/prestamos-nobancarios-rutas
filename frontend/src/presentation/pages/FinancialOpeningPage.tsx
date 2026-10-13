import { useEffect, useRef, useState, type ReactElement } from 'react';
import { financialOpeningUseCases } from '../../app/financial-opening';
import type { FinancialOpening, FinancialOpeningResponse } from '../../domain/entities/financial-opening';
import { HttpApiError } from '../../infrastructure/api/api-client';
import { MoneyInput } from '../components/MoneyInput';
import { canPerformOpening, financialOpeningConfirmationSummary, financialOpeningFieldErrors, formatCRC,
  normalizeAmount } from '../helpers/financial-opening';
import { useAuth } from '../hooks/auth-context';

type FormState = { openingDate: string; initialPortfolio: string; initialUncollectibleAmount: string;
  initialAvailableAmount: string; historicalSeedCapital: string; observations: string };
type OpeningField = Exclude<keyof FormState, 'observations'>;
type OpeningFieldErrors = Partial<Record<OpeningField, string>>;
const initialForm: FormState = { openingDate: '', initialPortfolio: '', initialUncollectibleAmount: '',
  initialAvailableAmount: '', historicalSeedCapital: '', observations: '' };

export function FinancialOpeningPage(): ReactElement {
  const { can } = useAuth();
  const [state, setState] = useState<FinancialOpeningResponse | null>(null);
  const [form, setForm] = useState<FormState>(initialForm);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<OpeningFieldErrors>({});
  const [success, setSuccess] = useState('');
  const load = async () => {
    try { setState(await financialOpeningUseCases.get.execute()); setError(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No fue posible cargar la apertura financiera.'); }
  };
  useEffect(() => { void load(); }, []);
  const update = (field: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setError(null); setSuccess('');
  };
  const requestConfirmation = () => {
    const errors = financialOpeningFieldErrors(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length) { setError('Revisa los campos indicados antes de continuar.'); return; }
    setError(null); setConfirming(true);
  };
  const submit = async () => {
    const errors = financialOpeningFieldErrors(form);
    if (Object.keys(errors).length) { setFieldErrors(errors); setError('Revisa los campos indicados antes de continuar.'); setConfirming(false); return; }
    setSaving(true); setError(null); setFieldErrors({});
    try {
      const opening = await financialOpeningUseCases.perform.execute({ ...form,
        initialPortfolio: normalizeAmount(form.initialPortfolio),
        initialUncollectibleAmount: normalizeAmount(form.initialUncollectibleAmount),
        initialAvailableAmount: normalizeAmount(form.initialAvailableAmount),
        historicalSeedCapital: normalizeAmount(form.historicalSeedCapital),
        observations: form.observations.trim() || null });
      setState({ configured: true, opening }); setConfirming(false); setSuccess('Apertura financiera realizada correctamente.');
    } catch (reason) {
      if (reason instanceof HttpApiError && reason.fieldErrors.length) {
        setFieldErrors(Object.fromEntries(reason.fieldErrors.map((item) => [item.field, item.message])) as OpeningFieldErrors);
        setConfirming(false);
      }
      setError(reason instanceof Error ? reason.message : 'No fue posible realizar la apertura financiera.');
    } finally { setSaving(false); }
  };
  if (error && !state) return <section className="payment-page"><div className="catalog-message catalog-message--error" role="alert">{error}</div></section>;
  const amount = (field: OpeningField, label: string) => {
    const id = `financial-opening-${field}`, fieldError = fieldErrors[field];
    return <label htmlFor={id}>{label}<MoneyInput id={id} value={form[field]} aria-invalid={Boolean(fieldError)}
      aria-describedby={fieldError ? `${id}-error` : undefined} onChange={(value) => update(field, value)} />
      {fieldError && <span id={`${id}-error`} className="form-error">{fieldError}</span>}</label>;
  };
  const dateError = fieldErrors.openingDate;
  return <section className="payment-page" aria-labelledby="financial-opening-title">
    <div className="payment-heading"><div><h2 id="financial-opening-title">Configuración financiera</h2>
      <p>Define el punto de partida para el control financiero del negocio.</p></div></div>
    {error && !confirming && <div className="catalog-message catalog-message--error" role="alert">{error}</div>}
    {success && <div className="success-message" role="status">{success}</div>}
    {state?.configured && state.opening ? <ReadOnlyOpening opening={state.opening} /> :
      <form className="financial-opening-form" onSubmit={(event) => { event.preventDefault(); if (canPerformOpening(can)) requestConfirmation(); }}>
        <div className="opening-section"><h3>Fecha de apertura</h3><label htmlFor="financial-opening-date">Fecha
          <input id="financial-opening-date" type="date" value={form.openingDate} aria-invalid={Boolean(dateError)}
            aria-describedby={dateError ? 'financial-opening-date-error' : undefined}
            onChange={(event) => update('openingDate', event.target.value)} />
          {dateError && <span id="financial-opening-date-error" className="form-error">{dateError}</span>}</label></div>
        <div className="opening-section"><h3>Cartera inicial</h3>{amount('initialPortfolio', 'Importe')}</div>
        <div className="opening-section"><h3>Capital incobrable inicial</h3>{amount('initialUncollectibleAmount', 'Importe')}</div>
        <div className="opening-grid"><div className="opening-section"><h3>Importe disponible</h3>{amount('initialAvailableAmount', 'Importe')}</div>
          <div className="opening-section"><h3>Capital semilla histórico</h3>{amount('historicalSeedCapital', 'Importe')}</div></div>
        <div className="opening-section"><h3>Observaciones</h3><label>Opcional<textarea value={form.observations}
          onChange={(event) => update('observations', event.target.value)} /></label></div>
        {canPerformOpening(can) && <button className="button button--primary" type="submit">Continuar</button>}
      </form>}
    {confirming && <ConfirmationDialog form={form} saving={saving} error={error} onCancel={() => { if (!saving) setConfirming(false); }}
      onConfirm={() => { void submit(); }} />}
  </section>;
}

function ReadOnlyOpening({ opening }: { opening: FinancialOpening }): ReactElement {
  return <div className="opening-readonly"><span className="status-badge status-badge--active">APERTURA FINANCIERA REALIZADA</span>
    <dl className="opening-values">{[['Fecha de apertura', opening.openingDate], ['Cartera inicial', formatCRC(opening.initialPortfolio)],
      ['Capital incobrable inicial', formatCRC(opening.initialUncollectibleAmount)], ['Importe disponible', formatCRC(opening.initialAvailableAmount)],
      ['Capital semilla histórico', formatCRC(opening.historicalSeedCapital)], ['Realizada por', opening.openedBy.fullName],
      ['Realizada el', new Date(opening.openedAt).toLocaleString('es-CR')]].map(([label, value]) =>
      <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {opening.observations && <p><strong>Observaciones:</strong> {opening.observations}</p>}</div>;
}

function ConfirmationDialog({ form, saving, error, onCancel, onConfirm }: { form: FormState; saving: boolean;
  error: string | null; onCancel: () => void; onConfirm: () => void }): ReactElement {
  const dialog = useRef<HTMLDivElement>(null), confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    (saving ? dialog.current : confirm.current)?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (!saving) onCancel(); return; }
      if (event.key !== 'Tab' || !dialog.current) return;
      const controls = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not([disabled])'));
      const first = controls[0], last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); dialog.current.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown); return () => document.removeEventListener('keydown', keydown);
  }, [saving, onCancel]);
  return <div className="dialog-backdrop"><div ref={dialog} tabIndex={-1} className="dialog" role="dialog" aria-modal="true"
    aria-labelledby="opening-confirm-title" aria-busy={saving}><h3 id="opening-confirm-title">Realizar apertura financiera</h3>
    <p>Verifica los valores. Esta apertura no puede editarse directamente.</p>
    <dl className="opening-summary">{financialOpeningConfirmationSummary(form).map(([label, value]) =>
      <div key={label}><dt>{label}</dt><dd>{label === 'Fecha de apertura' ? value : formatCRC(value)}</dd></div>)}</dl>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button className="button button--secondary" type="button" disabled={saving} onClick={onCancel}>Cancelar</button>
      <button ref={confirm} className="button button--primary" type="button" disabled={saving} onClick={onConfirm}>
        {saving ? 'Confirmando…' : 'Confirmar apertura'}</button></div></div></div>;
}
