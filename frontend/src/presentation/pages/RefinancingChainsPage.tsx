import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement, type RefObject } from 'react';
import { Link, useParams } from 'react-router-dom';
import { createRefinancingChains } from '../../app/loan-refinancing';
import { RefinancingChainController, type RefinancingChainState } from '../../application/use-cases/refinancing-chain-controller';
import type { RefinancingCustomerOption } from '../../application/ports/loan-refinancing.repository';
import type { CustomerRefinancingChains, RefinancingChain, RefinancingChainLoan, RefinancingChainSummary, RefinancingChainTransition } from '../../domain/entities/loan-refinancing';
import { HttpApiError } from '../../infrastructure/api/api-client';
import { formatDateOnlyForDisplay } from '../../shared/utils/date';
import { formatCRCAggregate, moneyFromCents } from '../../shared/utils/money';
import { TableActions } from '../components/TableActions';
import { formatLoanStatus } from '../helpers/loan';
import { useAuth } from '../hooks/auth-context';

type CustomerSummary = Pick<RefinancingChainSummary,
  'refinancingCount' | 'totalOutstandingPrincipalTransferred' | 'totalCapitalizedOutstandingInterest' |
  'totalNewMoneyDisbursed' | 'totalNewInterestContracted' | 'totalPaymentsReceived'> & {
  chainCount: number;
  totalCashActuallyDisbursed: string | null;
};

const aggregateCents = (values: string[]): string => moneyFromCents(values.reduce((total, value) => {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error('Invalid aggregate amount.');
  return total + BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
}, 0n));

function summarizeCustomerChains(data: CustomerRefinancingChains): CustomerSummary {
  const summaries = data.chains.map((chain) => chain.summary);
  const sum = (field: keyof Pick<RefinancingChainSummary,
    'totalOutstandingPrincipalTransferred' | 'totalCapitalizedOutstandingInterest' | 'totalNewMoneyDisbursed' |
    'totalNewInterestContracted' | 'totalPaymentsReceived'>) => aggregateCents(summaries.map((summary) => summary[field]));
  return {
    chainCount: data.chains.length,
    refinancingCount: summaries.reduce((total, summary) => total + summary.refinancingCount, 0),
    totalOutstandingPrincipalTransferred: sum('totalOutstandingPrincipalTransferred'),
    totalCapitalizedOutstandingInterest: sum('totalCapitalizedOutstandingInterest'),
    totalNewMoneyDisbursed: sum('totalNewMoneyDisbursed'),
    totalNewInterestContracted: sum('totalNewInterestContracted'),
    totalPaymentsReceived: sum('totalPaymentsReceived'),
    totalCashActuallyDisbursed: summaries.some((summary) => summary.totalCashActuallyDisbursed === null)
      ? null : aggregateCents(summaries.map((summary) => summary.totalCashActuallyDisbursed!)),
  };
}

function chainErrorMessage(error: unknown, byLoan: boolean): string {
  if (error instanceof HttpApiError) {
    if (error.status === 403) return 'No tienes permiso para consultar cadenas de refinanciamiento.';
    if (error.status === 404) return byLoan
      ? 'El préstamo no existe o no tiene una cadena de refinanciamiento.'
      : 'El cliente no está disponible.';
    if (error.status === 409 && error.reasonCode === 'CHAIN_INTEGRITY_ERROR')
      return 'No fue posible reconstruir esta cadena debido a una inconsistencia de integridad.';
  }
  if (error instanceof TypeError) return 'No se pudo conectar al servidor. Intenta nuevamente.';
  return 'No se pudieron cargar las cadenas de refinanciamiento. Intenta nuevamente.';
}

const customerErrorMessage = (error: unknown): string => error instanceof HttpApiError && error.status === 403
  ? 'No tienes permiso para consultar clientes.'
  : error instanceof TypeError ? 'No se pudo conectar al servidor. Intenta nuevamente.'
    : 'No se pudieron cargar los clientes. Intenta nuevamente.';

export function RefinancingChainsPage({ controller: supplied }: { controller?: RefinancingChainController } = {}): ReactElement {
  const { loanId } = useParams();
  const { can } = useAuth();
  const [controller] = useState(() => supplied ?? createRefinancingChains());
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [customerOpen, setCustomerOpen] = useState(false);
  const customerSearchRef = useRef<HTMLInputElement>(null);
  const customerTriggerRef = useRef<HTMLButtonElement>(null);
  const previousCustomerSearch = useRef(state.customerSearch);
  useEffect(() => {
    if (loanId) void controller.loadLoan(loanId);
  }, [controller, loanId]);
  useEffect(() => {
    if (!loanId && state.selectedCustomer) void controller.loadCustomer(state.selectedCustomer.id);
  }, [controller, loanId, state.selectedCustomer?.id]);
  useEffect(() => {
    if (!customerOpen || !can('customers.view')) return;
    const delay = previousCustomerSearch.current !== state.customerSearch && state.customerSearch.trim() ? 250 : 0;
    previousCustomerSearch.current = state.customerSearch;
    const timer = window.setTimeout(() => { void controller.loadCustomers(); }, delay);
    return () => window.clearTimeout(timer);
  }, [controller, customerOpen, state.customerSearch, state.customerPage, can]);
  useEffect(() => {
    if (!customerOpen) return;
    customerSearchRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setCustomerOpen(false); };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); controller.closeCustomerSearch(); customerTriggerRef.current?.focus(); };
  }, [customerOpen, controller]);
  useEffect(() => () => { if (!supplied) controller.dispose(); }, [controller, supplied]);
  return <RefinancingChainsView state={state} controller={controller} loanId={loanId}
    canSelectCustomer={can('customers.view')} canViewLoans={can('loans.view')} customerOpen={customerOpen}
    onOpenCustomer={() => { controller.openCustomerSearch(); setCustomerOpen(true); }}
    onCloseCustomer={() => setCustomerOpen(false)} customerSearchRef={customerSearchRef}
    customerTriggerRef={customerTriggerRef} />;
}

function SummaryGrid({ values }: { values: Array<[string, string | number | null]> }): ReactElement {
  return <dl className="refinancing-chain__summary-grid">{values.map(([label, value]) => <div key={label}>
    <dt>{label}</dt><dd>{typeof value === 'string' ? formatCRCAggregate(value) : value ?? 'No disponible'}</dd>
  </div>)}</dl>;
}

function LoanCard({ loan, canViewLoans }: { loan: RefinancingChainLoan; canViewLoans: boolean }): ReactElement {
  const refinancedBalance = loan.status === 'REFINANCED' && loan.financialBalance !== '0.00';
  return <article className="refinancing-chain__loan-card" aria-label={`Préstamo ${loan.loanNumber}`}>
    <header><div>{loan.isRoot && <span className="refinancing-chain__node-label">PRÉSTAMO INICIAL</span>}
      {loan.isTerminal && <span className="refinancing-chain__node-label">PRÉSTAMO TERMINAL</span>}
      <h3>Préstamo #{loan.loanNumber}</h3></div>
      <span className={`status-badge refinancing-chain__status refinancing-chain__status--${loan.status.toLowerCase()}`}>
        {formatLoanStatus(loan.status)}</span></header>
    <dl className="refinancing-chain__facts">
      <div><dt>Fecha de inicio</dt><dd>{formatDateOnlyForDisplay(loan.startDate)}</dd></div>
      <div><dt>Principal</dt><dd>{formatCRCAggregate(loan.principal)}</dd></div>
      <div><dt>Interés contractual</dt><dd>{formatCRCAggregate(loan.interestAmount)}</dd></div>
      <div><dt>Total contractual</dt><dd>{formatCRCAggregate(loan.totalAmount)}</dd></div>
      <div><dt>Pagado</dt><dd>{formatCRCAggregate(loan.paidAmount)}</dd></div>
      <div><dt>Capital recuperado</dt><dd>{formatCRCAggregate(loan.paidPrincipal)}</dd></div>
      <div><dt>Interés recuperado</dt><dd>{formatCRCAggregate(loan.paidInterest)}</dd></div>
      <div><dt>Capital pendiente</dt><dd>{formatCRCAggregate(loan.outstandingPrincipal)}</dd></div>
      <div><dt>Interés pendiente</dt><dd>{formatCRCAggregate(loan.outstandingInterest)}</dd></div>
      <div><dt>Saldo financiero</dt><dd>{formatCRCAggregate(loan.financialBalance)}</dd></div>
    </dl>
    {refinancedBalance && <p className="refinancing-chain__note">Saldo trasladado al siguiente refinanciamiento.</p>}
    {canViewLoans && <Link className="button button--secondary" to={`/loans/${encodeURIComponent(loan.loanId)}`}>Ver préstamo</Link>}
  </article>;
}

function TransitionCard({ transition }: { transition: RefinancingChainTransition }): ReactElement {
  return <article className="refinancing-chain__transition" aria-label={`Refinanciamiento ${transition.refinancingId}`}>
    <span className="refinancing-chain__connector" aria-hidden="true">↓</span>
    <header><span className="refinancing-chain__node-label">REFINANCIAMIENTO</span>
      <h3>{formatDateOnlyForDisplay(transition.refinancingDate)}</h3></header>
    <dl className="refinancing-chain__facts">
      <div><dt>Capital trasladado</dt><dd>{formatCRCAggregate(transition.outstandingPrincipalTransferred)}</dd></div>
      <div><dt>Interés capitalizado</dt><dd>{formatCRCAggregate(transition.capitalizedOutstandingInterest)}</dd></div>
      <div><dt>Dinero nuevo</dt><dd>{formatCRCAggregate(transition.newMoneyDisbursed)}</dd></div>
      <div><dt>Principal nuevo</dt><dd>{formatCRCAggregate(transition.newContractualPrincipal)}</dd></div>
      <div><dt>Interés nuevo</dt><dd>{formatCRCAggregate(transition.newInterestAmount)}</dd></div>
      <div><dt>Total nuevo</dt><dd>{formatCRCAggregate(transition.newContractualTotal)}</dd></div>
    </dl>
    <Link className="button button--secondary" to={`/loan-refinancings/${encodeURIComponent(transition.refinancingId)}`}>
      Ver refinanciamiento</Link>
  </article>;
}

export function RefinancingChainDetail({ chain, canViewLoans }: { chain: RefinancingChain; canViewLoans: boolean }): ReactElement {
  return <div className="refinancing-chain__detail">
    <section className="refinancing-chain__chain-summary" aria-labelledby="chain-summary-title">
      <div><span className="eyebrow">RESUMEN DE LA CADENA</span><h2 id="chain-summary-title">
        Préstamo #{chain.loans[0]?.loanNumber} → #{chain.loans.at(-1)?.loanNumber}</h2>
        <p>Inició el {formatDateOnlyForDisplay(chain.startedAt)} · Terminal {formatLoanStatus(chain.loans.at(-1)?.status ?? '')}</p></div>
      <SummaryGrid values={[
        ['Préstamos', chain.summary.loanCount], ['Refinanciamientos', chain.summary.refinancingCount],
        ['Capital trasladado', chain.summary.totalOutstandingPrincipalTransferred],
        ['Interés capitalizado', chain.summary.totalCapitalizedOutstandingInterest],
        ['Dinero nuevo', chain.summary.totalNewMoneyDisbursed], ['Interés nuevo pactado', chain.summary.totalNewInterestContracted],
        ['Desembolso inicial', chain.summary.rootDisbursedAmount], ['Efectivo desembolsado', chain.summary.totalCashActuallyDisbursed],
        ['Pagos recibidos', chain.summary.totalPaymentsReceived], ['Capital aplicado', chain.summary.totalPrincipalApplied],
        ['Interés aplicado', chain.summary.totalInterestApplied],
      ]} />
    </section>
    <section className="refinancing-chain__history" aria-label="Historia de la cadena">
      {chain.loans.map((loan, index) => <div className="refinancing-chain__step" key={loan.loanId}>
        <LoanCard loan={loan} canViewLoans={canViewLoans} />
        {chain.transitions[index] && <TransitionCard transition={chain.transitions[index]} />}
      </div>)}
    </section>
  </div>;
}

function CustomerChains({ data }: { data: CustomerRefinancingChains }): ReactElement {
  const summary = summarizeCustomerChains(data);
  return <div className="refinancing-chain__customer-result">
    <section className="refinancing-chain__customer-summary" aria-labelledby="customer-chain-summary-title">
      <h2 id="customer-chain-summary-title">Resumen del cliente</h2>
      <SummaryGrid values={[
        ['Cadenas', summary.chainCount], ['Refinanciamientos', summary.refinancingCount],
        ['Capital trasladado', summary.totalOutstandingPrincipalTransferred],
        ['Interés capitalizado', summary.totalCapitalizedOutstandingInterest],
        ['Dinero nuevo', summary.totalNewMoneyDisbursed], ['Interés nuevo pactado', summary.totalNewInterestContracted],
        ['Efectivo desembolsado', summary.totalCashActuallyDisbursed], ['Pagos recibidos', summary.totalPaymentsReceived],
      ]} />
    </section>
    <div className="refinancing-chain__cards">{data.chains.map((chain) => <article className="refinancing-chain__overview" key={chain.rootLoanId}>
      <header><span className="refinancing-chain__node-label">CADENA DE REFINANCIAMIENTO</span>
        <h2>#{chain.loans[0]?.loanNumber} → #{chain.loans.at(-1)?.loanNumber}</h2></header>
      <dl className="refinancing-chain__facts">
        <div><dt>Fecha de inicio</dt><dd>{formatDateOnlyForDisplay(chain.startedAt)}</dd></div>
        <div><dt>Préstamos</dt><dd>{chain.summary.loanCount}</dd></div>
        <div><dt>Refinanciamientos</dt><dd>{chain.summary.refinancingCount}</dd></div>
        <div><dt>Estado terminal</dt><dd>{formatLoanStatus(chain.loans.at(-1)?.status ?? '')}</dd></div>
        <div><dt>Efectivo desembolsado</dt><dd>{chain.summary.totalCashActuallyDisbursed === null
          ? 'No disponible' : formatCRCAggregate(chain.summary.totalCashActuallyDisbursed)}</dd></div>
        <div><dt>Pagos recibidos</dt><dd>{formatCRCAggregate(chain.summary.totalPaymentsReceived)}</dd></div>
      </dl>
      <Link className="button button--primary" to={`/loan-refinancings/chains/loan/${encodeURIComponent(chain.rootLoanId)}`}>Ver cadena</Link>
    </article>)}</div>
  </div>;
}

export function RefinancingChainsView({ state, controller, loanId, canSelectCustomer, canViewLoans, customerOpen,
  onOpenCustomer, onCloseCustomer, customerSearchRef, customerTriggerRef }: {
  state: RefinancingChainState; controller: RefinancingChainController; loanId?: string;
  canSelectCustomer: boolean; canViewLoans: boolean; customerOpen: boolean;
  onOpenCustomer: () => void; onCloseCustomer: () => void;
  customerSearchRef?: RefObject<HTMLInputElement | null>; customerTriggerRef?: RefObject<HTMLButtonElement | null>;
}): ReactElement {
  const byLoan = Boolean(loanId);
  return <section className="page-section refinancing-chain" aria-labelledby="refinancing-chains-title">
    <header className="loan-list__heading"><div><span className="eyebrow">REFINANCIAMIENTOS</span>
      <h1 id="refinancing-chains-title">Cadenas de refinanciamiento</h1>
      <p>Visualiza la continuidad de las operaciones de refinanciamiento de un cliente.</p></div>
      {byLoan && <Link className="button button--secondary" to="/loan-refinancings/chains">Consultar por cliente</Link>}
    </header>
    {!byLoan && <section className="refinancing-chain__customer-picker" aria-label="Cliente de las cadenas">
      {state.selectedCustomer ? <div><strong>{state.selectedCustomer.fullName}</strong>
        <span>{state.selectedCustomer.identification}</span></div> : <p>Seleccione un cliente para consultar sus cadenas.</p>}
      <button ref={customerTriggerRef} className="button button--secondary" type="button"
        disabled={!canSelectCustomer} onClick={onOpenCustomer}>
        {state.selectedCustomer ? 'Cambiar cliente' : 'Seleccionar cliente'}</button>
      {state.selectedCustomer && <button className="button button--secondary" type="button"
        onClick={() => controller.selectCustomer(null)}>Limpiar cliente</button>}
      {!canSelectCustomer && <small>El selector de clientes no está disponible con tus permisos.</small>}
    </section>}
    {(state.loading || byLoan && !state.chain && state.error === null) &&
      <p className="loan-list__message" role="status">Cargando cadenas de refinanciamiento…</p>}
    {state.error !== null && <div className="loan-list__message loan-list__message--error" role="alert">
      {chainErrorMessage(state.error, byLoan)}
      <button className="button button--secondary" type="button" onClick={() => {
        if (loanId) void controller.loadLoan(loanId);
        else if (state.selectedCustomer) void controller.loadCustomer(state.selectedCustomer.id);
      }}>Reintentar</button>
    </div>}
    {!state.loading && state.error === null && state.chain && <>
      <div className="refinancing-chain__customer"><strong>{state.chain.customer.fullName}</strong>
        <span>{state.chain.customer.identification}</span></div>
      <RefinancingChainDetail chain={state.chain} canViewLoans={canViewLoans} />
    </>}
    {!state.loading && state.error === null && state.customerChains && <>
      <div className="refinancing-chain__customer"><strong>{state.customerChains.customer.fullName}</strong>
        <span>{state.customerChains.customer.identification}</span></div>
      {state.customerChains.chains.length ? <CustomerChains data={state.customerChains} /> :
        <p className="loan-list__message">Este cliente no tiene cadenas de refinanciamiento.</p>}
    </>}
    {customerOpen && canSelectCustomer && <div className="dialog-backdrop"><div className="dialog loan-customer-dialog" role="dialog"
      aria-modal="true" aria-labelledby="chain-client-title">
      <div className="loan-customer-dialog__header"><h2 id="chain-client-title">Seleccionar cliente</h2></div>
      <div className="loan-customer-dialog__search"><input ref={customerSearchRef} className="form-control" type="search"
        maxLength={120} aria-label="Buscar cliente" placeholder="Nombre o identificación" value={state.customerSearch}
        onChange={(event) => controller.setCustomerSearch(event.target.value)} /></div>
      {state.loadingCustomers && <p role="status" className="loan-list__message">Cargando clientes…</p>}
      {state.customerError !== null && <div role="alert" className="loan-list__message loan-list__message--error">
        {customerErrorMessage(state.customerError)}
        <button className="button button--secondary" type="button" onClick={() => { void controller.loadCustomers(); }}>Reintentar</button>
      </div>}
      {!state.loadingCustomers && state.customerError === null && state.customers && !state.customers.items.length &&
        <p className="loan-list__message">No se encontraron clientes.</p>}
      {!state.loadingCustomers && state.customerError === null && state.customers && state.customers.items.length > 0 &&
        <div className="catalog-table-wrap loan-customer-dialog__table-wrap" role="region" aria-label="Clientes disponibles" tabIndex={0}>
          <table className="catalog-table loan-customer-table"><caption className="loan-list__sr-only">Seleccionar un cliente</caption>
            <thead><tr><th scope="col">Identificación</th><th scope="col">Nombre</th><th scope="col">Acción</th></tr></thead>
            <tbody>{state.customers.items.map((customer: RefinancingCustomerOption) => <tr key={customer.id}>
              <td>{customer.identification}</td><td>{customer.fullName}</td><td><TableActions actions={[
                { key: 'select', icon: 'view', label: 'Seleccionar', title: 'Seleccionar cliente',
                  ariaLabel: `Seleccionar cliente ${customer.fullName}`,
                  onClick: () => { controller.selectCustomer(customer); onCloseCustomer(); } },
              ]} /></td></tr>)}</tbody></table>
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
