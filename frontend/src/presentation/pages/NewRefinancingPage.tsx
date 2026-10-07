import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement, type RefObject } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createRefinancingConfirmation, createRefinancingConditions, createRefinancingStepOne } from '../../app/loan-refinancing';
import { RefinancingStepOneController, type RefinancingStepOneState } from '../../application/use-cases/refinancing-step-one-controller';
import { RefinancingConditionsController, type RefinancingConditionsState } from '../../application/use-cases/refinancing-conditions-controller';
import { buildRefinancingReview, RefinancingConfirmationController, type RefinancingConfirmationState } from '../../application/use-cases/refinancing-confirmation-controller';
import type { RefinancingPageSize, RefinancingPreview, RefinancingReasonCode } from '../../domain/entities/loan-refinancing';
import { HttpApiError } from '../../infrastructure/api/api-client';
import { formatDateOnlyForDisplay } from '../../shared/utils/date';
import { formatCRC } from '../../shared/utils/money';
import { TableActions } from '../components/TableActions';
import { formatLoanStatus } from '../helpers/loan';
import { RefinancingConditionsView } from './RefinancingConditionsView';
import { RefinancingConfirmationView } from './RefinancingConfirmationView';
import { refinancingFailureMessage } from '../helpers/refinancing-errors';
import { RefinancingResultView } from './RefinancingResultView';
import { loanIdFromSearch } from '../helpers/loan-id-query';

function lookupError(error: unknown, kind: 'list' | 'preview'): string {
  if (error instanceof HttpApiError) {
    if (error.status === 403) return 'No tienes permiso para consultar refinanciamientos.';
    if (error.status === 404) return 'El préstamo ya no está disponible. Selecciona otro préstamo.';
    if (error.status === 409) return 'La información del préstamo cambió. Actualiza la selección.';
  }
  if (error instanceof TypeError) return 'No se pudo conectar al servidor. Intenta nuevamente.';
  return kind === 'list' ? 'No se pudieron cargar los préstamos. Intenta nuevamente.' :
    'No se pudo consultar el préstamo. Intenta nuevamente.';
}

function ineligibilityReason(code: RefinancingReasonCode | null, missing: string): string {
  switch (code) {
    case 'MINIMUM_PAYMENT_NOT_MET':
      return `No cumple el mínimo requerido para refinanciar. Faltan ${formatCRC(missing)} para alcanzarlo.`;
    case 'FINANCIAL_INTEGRITY_ERROR':
      return 'No se puede continuar porque la información financiera del préstamo requiere revisión.';
    case 'LOAN_NOT_ACTIVE': return 'Solo se pueden refinanciar préstamos activos.';
    case 'NO_OUTSTANDING_BALANCE': return 'El préstamo no tiene saldo pendiente para refinanciar.';
    default: return 'El préstamo no cumple las condiciones para refinanciar.';
  }
}

export function NewRefinancingPage({ controller: supplied, conditionsController: suppliedConditions, confirmationController: suppliedConfirmation }: {
  controller?: RefinancingStepOneController; conditionsController?: RefinancingConditionsController;
  confirmationController?: RefinancingConfirmationController;
} = {}): ReactElement {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { id: linkedLoanId, error: linkedLoanError } = loanIdFromSearch(searchParams.toString());
  const [controller] = useState(() => supplied ?? createRefinancingStepOne());
  const [conditionsController] = useState(() => suppliedConditions ?? createRefinancingConditions());
  const [confirmationController] = useState(() => suppliedConfirmation ?? createRefinancingConfirmation());
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const conditionState = useSyncExternalStore(conditionsController.subscribe, conditionsController.getSnapshot, conditionsController.getSnapshot);
  const confirmationState = useSyncExternalStore(confirmationController.subscribe, confirmationController.getSnapshot, confirmationController.getSnapshot);
  const searchRef = useRef<HTMLInputElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const wasSelected = useRef(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (linkedLoanId) {
      if (state.originLoanId !== linkedLoanId) void controller.select(linkedLoanId);
      return;
    }
    const timer = window.setTimeout(() => { void controller.load(); }, state.search.trim() ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [controller, linkedLoanId, state.originLoanId, state.search, state.page, state.pageSize]);
  useEffect(() => () => { if (!supplied) controller.dispose(); }, [controller, supplied]);
  useEffect(() => () => { if (!suppliedConditions) conditionsController.dispose(); }, [conditionsController, suppliedConditions]);
  useEffect(() => () => { if (!suppliedConfirmation) confirmationController.dispose(); }, [confirmationController, suppliedConfirmation]);
  useEffect(() => {
    if (wasSelected.current && !state.originLoanId) searchRef.current?.focus();
    wasSelected.current = state.originLoanId !== null;
  }, [state.originLoanId]);
  useEffect(() => { if (confirmationState.result) resultHeadingRef.current?.focus(); }, [confirmationState.result]);

  const continueToConditions = () => {
    if (!controller.canContinue() || !state.originPreview) return;
    setNotice('');
    conditionsController.setPreview(state.originPreview);
    controller.goToConditions();
    void conditionsController.loadOptions();
  };
  const continueToConfirmation = () => {
    const origin = controller.getSnapshot();
    const current = conditionsController.getSnapshot();
    const draft = conditionsController.evaluate();
    if (origin.step !== 'CONDITIONS' || !controller.canContinue() || !conditionsController.canProceed() ||
      !origin.originPreview || !current.preview || current.preview.loanId !== origin.originPreview.loanId ||
      current.preview.baseline !== origin.originPreview.baseline || !draft?.principal || !draft.total) return;
    const frequencyName = current.frequencies.find((item) => item.id === current.conditions.paymentFrequencyId)?.name;
    const preferredMethodName = current.methods.find((item) => item.id === current.conditions.preferredPaymentMethodId)?.name;
    const disbursementMethodName = current.methods.find((item) => item.id === current.conditions.disbursementPaymentMethodId)?.name ?? null;
    if (!frequencyName || !preferredMethodName || (current.conditions.disbursementPaymentMethodId && !disbursementMethodName)) return;
    if (confirmationController.prepare(buildRefinancingReview(current.preview, current.conditions, draft.plan,
      draft.principal, draft.total, frequencyName, preferredMethodName, disbursementMethodName))) controller.goToConfirmation();
  };
  const confirm = async (allowed: boolean) => {
    if (controller.getSnapshot().step !== 'CONFIRMATION' || !conditionsController.canProceed()) return;
    const outcome = await confirmationController.confirm(allowed);
    if (outcome === 'SUCCESS') {
      const receipt = confirmationController.getSnapshot().result;
      if (receipt) navigate(`/loan-refinancings/${encodeURIComponent(receipt.refinancingId)}`, { replace: true,
        state: { createdRefinancing: receipt } });
    } else if (outcome === 'STALE_DATA' || outcome === 'CONCURRENT_REFINANCING') {
      confirmationController.invalidate();
      conditionsController.resetDraft();
      controller.goToOrigin();
      setNotice(refinancingFailureMessage(outcome));
    } else if (outcome === 'ALREADY_REFINANCED' || outcome === 'NOT_FOUND') {
      confirmationController.invalidate();
      conditionsController.resetDraft();
      controller.clearSelection();
      void controller.load();
      setNotice(refinancingFailureMessage(outcome));
    }
  };
  const startNew = () => {
    confirmationController.reset();
    conditionsController.resetDraft();
    controller.reset();
    setNotice('');
    void controller.load();
  };
  if (confirmationState.result) return <RefinancingResultView result={confirmationState.result} headingRef={resultHeadingRef} onNew={startNew} />;
  const clearSelection = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('loanId');
    setSearchParams(next, { replace: true });
    controller.clearSelection();
  };
  return <RefinancingStepOneView state={state} controller={controller} searchRef={searchRef} onContinue={continueToConditions}
    onBack={() => controller.goToOrigin()} conditionState={conditionState} conditionsController={conditionsController}
    onContinueToConfirmation={continueToConfirmation} confirmationState={confirmationState}
    onBackToConditions={() => { if (!confirmationController.getSnapshot().submitting) { confirmationController.clearFailure(); controller.backToConditions(); } }}
    onConfirm={(allowed) => { void confirm(allowed); }} onClearSelection={clearSelection} notice={notice || linkedLoanError || ''} />;
}

function FinancialGroup({ title, values }: { title: string; values: Array<{ label: string; amount: string }> }): ReactElement {
  return <section className="loan-confirmation__section" aria-label={title}>
    <h3>{title}</h3>
    <dl className="loan-confirmation__summary">
      {values.map(({ label, amount }) => <div key={label}><dt>{label}</dt><dd>{formatCRC(amount)}</dd></div>)}
    </dl>
  </section>;
}

function OriginPreview({ preview }: { preview: RefinancingPreview }): ReactElement {
  return <div className="refinancing-origin__preview" aria-label="Situación financiera del préstamo origen">
    <header className="refinancing-origin__identity">
      <div><p className="eyebrow">PRÉSTAMO ORIGEN</p><h2>Préstamo #{preview.loanNumber}</h2>
        <p>{preview.customer.name} · {preview.customer.identification}</p>
        <p>Inicio: {formatDateOnlyForDisplay(preview.startDate)}</p></div>
      <span className={`status-badge ${preview.status === 'ACTIVE' ? 'status-badge--active' : 'status-badge--inactive'}`}>
        {formatLoanStatus(preview.status)}</span>
    </header>
    <FinancialGroup title="CONTRATO ACTUAL" values={[
      { label: 'Capital', amount: preview.principal },
      { label: 'Interés contractual', amount: preview.interestAmount },
      { label: 'Total contractual', amount: preview.totalAmount },
    ]} />
    <FinancialGroup title="PAGOS RECIBIDOS" values={[
      { label: 'Total pagado', amount: preview.paidAmount },
      { label: 'Capital recuperado', amount: preview.paidPrincipal },
      { label: 'Interés recuperado', amount: preview.paidInterest },
    ]} />
    <FinancialGroup title="SALDO PENDIENTE" values={[
      { label: 'Capital pendiente', amount: preview.outstandingPrincipal },
      { label: 'Interés pendiente', amount: preview.outstandingInterest },
      { label: 'Saldo financiero', amount: preview.financialBalance },
    ]} />
    <section className="loan-confirmation__section refinancing-origin__eligibility" aria-labelledby="refinancing-requirement-title">
      <h3 id="refinancing-requirement-title">REQUISITO PARA REFINANCIAR</h3>
      <dl className="loan-confirmation__summary">
        <div><dt>Pagos válidos acumulados</dt><dd>{formatCRC(preview.paidAmount)}</dd></div>
        <div><dt>Mínimo requerido</dt><dd>{formatCRC(preview.minimumRequiredPayment)}</dd></div>
        <div><dt>Monto faltante</dt><dd>{formatCRC(preview.remainingToMinimum)}</dd></div>
      </dl>
      <p className={`refinancing-origin__eligibility-result ${preview.eligible ? 'refinancing-origin__eligibility-result--eligible' : 'refinancing-origin__eligibility-result--blocked'}`}
        role={preview.eligible ? 'status' : 'alert'}>
        {preview.eligible ? 'Cumple el mínimo requerido para refinanciar.' :
          ineligibilityReason(preview.reasonCode, preview.remainingToMinimum)}
      </p>
    </section>
  </div>;
}

export function RefinancingStepOneView({ state, controller, searchRef, onContinue, onBack, conditionState, conditionsController,
  onContinueToConfirmation, confirmationState, onBackToConditions, onConfirm, onClearSelection, notice }: {
  state: RefinancingStepOneState; controller: RefinancingStepOneController; searchRef?: RefObject<HTMLInputElement | null>;
  onContinue?: () => void; onBack?: () => void;
  conditionState?: RefinancingConditionsState; conditionsController?: RefinancingConditionsController;
  onContinueToConfirmation?: () => void; confirmationState?: RefinancingConfirmationState;
  onBackToConditions?: () => void; onConfirm?: (allowed: boolean) => void; onClearSelection?: () => void; notice?: string;
}): ReactElement {
  const selected = state.originLoanId !== null;
  const totalPages = Math.max(1, Math.ceil((state.list?.total ?? 0) / state.pageSize));
  return <section className="page-section loan-wizard refinancing-origin" aria-labelledby="refinancing-new-title">
    <div className="loan-wizard__card">
      <header className="loan-wizard__heading"><span className="eyebrow">REFINANCIAMIENTOS</span>
        <h1 id="refinancing-new-title">Nuevo refinanciamiento</h1>
         <p>Selecciona un préstamo activo, revisa su saldo y configura las nuevas condiciones.</p></header>
      <div className="loan-wizard__steps" aria-label="Pasos del refinanciamiento">
        <span className={state.step === 'ORIGIN' ? 'active' : 'complete'} aria-current={state.step === 'ORIGIN' ? 'step' : undefined}><b>1</b><strong>Préstamo origen</strong></span>
        <span className={state.step === 'CONDITIONS' ? 'active' : state.step === 'CONFIRMATION' ? 'complete' : ''}
          aria-current={state.step === 'CONDITIONS' ? 'step' : undefined}><b>2</b><strong>Nuevas condiciones</strong></span>
        <span className={state.step === 'CONFIRMATION' ? 'active' : ''} aria-current={state.step === 'CONFIRMATION' ? 'step' : undefined}
          aria-disabled={state.step !== 'CONFIRMATION' ? 'true' : undefined}><b>3</b><strong>Confirmación</strong></span>
      </div>

      {notice && state.step === 'ORIGIN' && <p className="catalog-message catalog-message--error" role="alert">{notice}</p>}

      {state.step === 'ORIGIN' && !selected && <section className="loan-list__surface" aria-labelledby="refinancing-select-title">
        <h2 className="refinancing-origin__section-title" id="refinancing-select-title">Seleccionar préstamo origen</h2>
        <div className="loan-list__toolbar" aria-label="Buscar préstamos activos">
          <label htmlFor="refinancing-origin-search">Buscar préstamo
            <input id="refinancing-origin-search" ref={searchRef} type="search" maxLength={120}
              placeholder="Buscar por número de préstamo, identificación o nombre" value={state.search}
              onChange={(event) => controller.setSearch(event.target.value)} />
          </label>
          <label htmlFor="refinancing-origin-page-size">Por página
            <select id="refinancing-origin-page-size" value={state.pageSize}
              onChange={(event) => controller.setPageSize(Number(event.target.value) as RefinancingPageSize)}>
              {[10, 20, 50].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
        </div>
        {state.loadingList && <p className="loan-list__message" role="status">Cargando préstamos activos…</p>}
        {state.listError !== null && <div className="loan-list__message loan-list__message--error" role="alert">
          {lookupError(state.listError, 'list')}
          <button className="button button--secondary" type="button" onClick={() => { void controller.load(); }}>Reintentar</button>
        </div>}
        {!state.loadingList && state.listError === null && state.list && (state.list.items.length ? <>
          <div className="loan-list__table-wrap" role="region" aria-label="Préstamos activos para refinanciar" tabIndex={0}>
            <table className="loan-list__table"><caption className="loan-list__sr-only">Préstamos disponibles para seleccionar</caption>
              <thead><tr><th scope="col">N.º</th><th scope="col">Cliente / identificación</th><th scope="col">Inicio</th>
                <th scope="col">Capital</th><th scope="col">Interés</th><th scope="col">Total</th>
                <th scope="col">Pagado</th><th scope="col">Saldo</th><th scope="col">Estado</th><th scope="col">Acciones</th></tr></thead>
              <tbody>{state.list.items.map((loan) => <tr key={loan.loanId}>
                <td>#{loan.loanNumber}</td><td><strong>{loan.customer.fullName}</strong><small>{loan.customer.identification}</small></td>
                <td>{formatDateOnlyForDisplay(loan.startDate)}</td>
                {[loan.principal, loan.interestAmount, loan.totalAmount, loan.paidAmount, loan.financialBalance].map((amount, index) =>
                  <td className="loan-list__numeric" key={index}>{formatCRC(amount)}</td>)}
                <td><span className="status-badge status-badge--active">{formatLoanStatus(loan.status)}</span></td>
                <td className="loan-list__actions"><TableActions ariaLabel={`Acciones del préstamo ${loan.loanNumber}`} actions={[
                  { key: 'select', icon: 'view', label: 'Seleccionar', title: 'Seleccionar préstamo',
                    ariaLabel: `Seleccionar préstamo ${loan.loanNumber}`, onClick: () => { void controller.select(loan.loanId); } },
                ]} /></td>
              </tr>)}</tbody></table>
          </div>
          <nav className="loan-list__pagination" aria-label="Páginas de préstamos para refinanciar">
            <button className="button button--secondary" type="button" disabled={state.page <= 1}
              onClick={() => controller.setPage(state.page - 1)}>Anterior</button>
            <span>Página {state.page} de {totalPages} · {state.list.total} préstamos</span>
            <button className="button button--secondary" type="button" disabled={state.page >= totalPages}
              onClick={() => controller.setPage(state.page + 1)}>Siguiente</button>
          </nav>
        </> : <p className="loan-list__message">{state.list.total ? 'No hay préstamos en esta página.' :
          state.search ? 'No se encontraron préstamos activos con esta búsqueda.' : 'No hay préstamos activos para seleccionar.'}</p>)}
        {!state.loadingList && state.listError === null && !state.list &&
          <p className="loan-list__message">Busca un préstamo activo para comenzar.</p>}
      </section>}

      {state.step === 'ORIGIN' && selected && <>
        {state.loadingPreview && <p className="loan-list__message" role="status">Consultando situación financiera del préstamo…</p>}
        {state.previewError !== null && <div className="loan-list__message loan-list__message--error" role="alert">
          {lookupError(state.previewError, 'preview')}
          <button className="button button--secondary" type="button"
            onClick={() => { if (state.originLoanId) void controller.select(state.originLoanId); }}>Reintentar</button>
        </div>}
        {state.originPreview && state.originPreview.loanId === state.originLoanId &&
          <OriginPreview preview={state.originPreview} />}
      </>}

      {state.step === 'ORIGIN' && <footer className="refinancing-origin__footer">
        {selected && <button className="button button--secondary" type="button" onClick={onClearSelection ?? (() => controller.clearSelection())}>Cambiar préstamo</button>}
        <button className="button button--primary" type="button" disabled={!controller.canContinue() || !onContinue}
          onClick={onContinue} aria-label="Continuar a nuevas condiciones">Continuar</button>
      </footer>}
      {state.step === 'CONDITIONS' && conditionState && conditionsController && onBack &&
        <RefinancingConditionsView state={conditionState} controller={conditionsController} onBack={onBack}
          onContinue={onContinueToConfirmation} />}
      {state.step === 'CONFIRMATION' && confirmationState && onBackToConditions && onConfirm &&
        <RefinancingConfirmationView state={confirmationState} onBack={onBackToConditions} onConfirm={onConfirm} />}
    </div>
  </section>;
}
