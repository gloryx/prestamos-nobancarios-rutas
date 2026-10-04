import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AuthIdentity } from '../../domain/entities/auth';
import type { RefinancingPreview, RefinancingResult } from '../../domain/entities/loan-refinancing';
import { RefinancingConfirmationController, buildRefinancingReview } from '../../application/use-cases/refinancing-confirmation-controller';
import { RefinancingStepOneController } from '../../application/use-cases/refinancing-step-one-controller';
import { canAccess, canAccessAll } from '../hooks/auth-permissions';
import { AuthContext, type AuthContextValue } from '../hooks/auth-context';
import { RefinancingConfirmationView } from './RefinancingConfirmationView';
import { RefinancingResultView } from './RefinancingResultView';
import { RefinancingStepOneView } from './NewRefinancingPage';

const preview: RefinancingPreview = {
  loanId: 'origin-1', loanNumber: '101', customer: { id: 'customer-1', name: 'Ana Solís', identification: '12345' },
  status: 'ACTIVE', startDate: '2026-09-01', principal: '150000.00', interestAmount: '30000.00',
  totalAmount: '180000.00', paidAmount: '30000.00', paidPrincipal: '30000.00', paidInterest: '0.00',
  outstandingPrincipal: '120000.00', outstandingInterest: '30000.00', financialBalance: '150000.00',
  pendingPlanAmount: '150000.00', minimumRequiredPayment: '30000.00', remainingToMinimum: '0.00',
  eligible: true, reasonCode: null, reason: null, reasons: [], baseline: 'a'.repeat(64),
};
const result: RefinancingResult = {
  refinancingId: 'ref-1', refinancingDate: '2026-10-01', createdAt: '2026-10-01T12:00:00Z',
  originLoan: { id: 'origin-1', loanNumber: '101', status: 'REFINANCED', startDate: '2026-09-01' },
  newLoan: { id: 'new-2', loanNumber: '102', status: 'ACTIVE', startDate: '2026-10-01' },
  customer: { id: 'customer-1', fullName: 'Ana Solís', identification: '12345' },
  financialComposition: { outstandingPrincipalTransferred: '119000.00', capitalizedOutstandingInterest: '31000.00',
    newMoneyDisbursed: '20000.00', newContractualPrincipal: '170000.00', newInterestAmount: '15000.00',
    newContractualTotal: '185000.00' },
  newContract: { paymentFrequency: { id: 'daily', name: 'Diaria', intervalUnit: 'DAY', intervalValue: 1 },
    preferredPaymentMethod: { id: 'cash', name: 'Efectivo' },
    disbursementPaymentMethod: { id: 'transfer', name: 'Transferencia' }, observations: 'REVISIÓN' },
  disbursement: { id: 'disb-1', cashMovementId: 'cash-1' }, createdBy: { id: 'user-1', fullName: 'Admin' },
};
const conditions = { refinancingDate: '2026-10-01', newMoney: '20000.00', newInterestAmount: '10000.00',
  disbursementPaymentMethodId: 'transfer', paymentFrequencyId: 'daily', preferredPaymentMethodId: 'cash',
  observations: 'Detalle', count: '2', mode: 'automatic' as const, customPlan: [] };
const plan = [{ sequence: 1, dueDate: '2026-10-02', pendingAmount: '90000.00' },
  { sequence: 2, dueDate: '2026-10-03', pendingAmount: '90000.00' }];
const user: AuthIdentity = { id: 'user-1', username: 'user', fullName: 'User',
  role: { id: 'role-1', code: 'STAFF', name: 'Staff', isSuperAdmin: false }, permissions: ['loans.refinance.view'] };

function withIdentity(node: ReactNode, identity: AuthIdentity = user) {
  const context: AuthContextValue = { user: identity, loading: false, can: (code) => canAccess(identity, code),
    canAll: (codes) => canAccessAll(identity, codes), login: async () => {}, logout: async () => {},
    changePassword: async () => {} };
  return renderToStaticMarkup(<MemoryRouter><AuthContext.Provider value={context}>{node}</AuthContext.Provider></MemoryRouter>);
}
function prepared(newMoney = '20000.00') {
  const controller = new RefinancingConfirmationController({ confirm: vi.fn(), detail: vi.fn() }, () => 'fixed-key', () => 'SERVER');
  const zero = newMoney === '0.00';
  controller.prepare(buildRefinancingReview(preview, { ...conditions, newMoney, disbursementPaymentMethodId: zero ? '' : 'transfer' },
    zero ? [{ sequence: 1, dueDate: '2026-10-02', pendingAmount: '160000.00' }] : plan,
    zero ? '150000.00' : '170000.00', zero ? '160000.00' : '180000.00',
    'Diaria', 'Efectivo', zero ? null : 'Transferencia'));
  return controller;
}

describe('refinancing confirmation presentation', () => {
  it('reviews origin, six distinct amounts, all conditions and the exact read-only reconciled plan', () => {
    const controller = prepared();
    const html = withIdentity(<RefinancingConfirmationView state={controller.getSnapshot()} onBack={() => {}} onConfirm={() => {}} />,
      { ...user, permissions: ['loans.refinance.view', 'loans.refinance.create'] });
    for (const text of ['Confirmación del refinanciamiento', 'PRÉSTAMO ORIGEN', '#101', 'Ana Solís', '12345', 'ACTIVE',
      'Capital original', 'Interés contractual actual', 'Total pagado válido', 'Capital recuperado', 'Interés recuperado',
      'Capital pendiente', 'Interés pendiente', 'Saldo financiero', 'Capital anterior pendiente',
      'Interés anterior capitalizado', 'Dinero nuevo desembolsado', 'Principal contractual nuevo', 'Interés nuevo',
      'Total contractual nuevo', 'Diaria', 'Cantidad de pagos', 'Efectivo', 'Transferencia', 'Detalle',
      '₡120.000,00', '₡30.000,00', '₡20.000,00', '₡170.000,00', '₡10.000,00', '₡180.000,00',
      '02/10/2026', '03/10/2026', '₡90.000,00', 'Total del plan', 'Total contractual', 'Diferencia',
      'Volver a nuevas condiciones', 'Confirmar refinanciamiento']) expect(html).toContain(text);
    expect(html).toContain('<th>#</th><th>Fecha</th><th>Monto</th>');
    expect(html).toContain('Diferencia</dt><dd>₡0,00');
    expect(html).toContain('una salida de Caja únicamente por el dinero nuevo: ₡20.000,00');
    expect(html).not.toContain('Interés pagado');
    expect(html).not.toContain('+ Agregar cuota');
    expect(html).not.toContain('type="date"');
    expect(html).not.toContain('₡170.000,00.</p>'); // Principal is never described as a cash outflow.
  });

  it('explains zero new money, without an invented disbursement method or cash outflow', () => {
    const controller = prepared('0.00');
    const html = withIdentity(<RefinancingConfirmationView state={controller.getSnapshot()} onBack={() => {}} onConfirm={() => {}} />);
    expect(html).toContain('Forma de desembolso</dt><dd>No aplica');
    expect(html).toContain('No se registrará un nuevo desembolso ni una salida de Caja.');
    expect(html).not.toContain('Transferencia');
  });

  it('keeps view-only users on review without a submit action and honors superadmin bypass', () => {
    const controller = prepared();
    const view = <RefinancingConfirmationView state={controller.getSnapshot()} onBack={() => {}} onConfirm={() => {}} />;
    expect(withIdentity(view)).toContain('No tienes permiso para confirmar refinanciamientos.');
    expect(withIdentity(view)).not.toContain('>Confirmar refinanciamiento</button>');
    const superadmin = { ...user, role: { ...user.role, isSuperAdmin: true } };
    expect(withIdentity(view, superadmin)).toContain('>Confirmar refinanciamiento</button>');
  });

  it('shows Steps 1 and 2 completed and Step 3 active without triggering a POST on entry', async () => {
    const origin = new RefinancingStepOneController({ search: vi.fn(), preview: vi.fn(async () => preview) });
    const confirmation = prepared();
    await origin.select(preview.loanId); origin.goToConditions(); origin.goToConfirmation();
    const html = withIdentity(<RefinancingStepOneView state={origin.getSnapshot()} controller={origin}
      confirmationState={confirmation.getSnapshot()} onBackToConditions={() => {}} onConfirm={() => {}} />);
    expect(html).toContain('class="complete"><b>1</b>');
    expect(html).toContain('class="complete"><b>2</b>');
    expect(html).toContain('class="active" aria-current="step"><b>3</b>');
    expect(html).toContain('Confirmación del refinanciamiento');
  });

  it('disables both actions during POST and exposes a readable confirming state', async () => {
    let finish!: (value: RefinancingResult) => void;
    const controller = new RefinancingConfirmationController({ confirm: vi.fn(() => new Promise<RefinancingResult>((resolve) => { finish = resolve; })),
      detail: vi.fn() }, () => 'key-1', () => 'SERVER');
    controller.prepare(buildRefinancingReview(preview, conditions, plan, '170000.00', '180000.00',
      'Diaria', 'Efectivo', 'Transferencia'));
    const pending = controller.confirm(true);
    const html = withIdentity(<RefinancingConfirmationView state={controller.getSnapshot()} onBack={() => {}} onConfirm={() => {}} />,
      { ...user, permissions: ['loans.refinance.view', 'loans.refinance.create'] });
    expect(html).toContain('disabled="">Volver a nuevas condiciones');
    expect(html).toContain('disabled="">Confirmando…');
    finish(result); await pending;
  });

  it('uses six server values, persisted statuses and existing routes in the success view', () => {
    const html = withIdentity(<RefinancingResultView result={result} onNew={() => {}} />,
      { ...user, permissions: [...user.permissions, 'loans.view'] });
    for (const text of ['REFINANCIAMIENTO CREADO', 'ref-1', '01/10/2026', 'Ana Solís', '12345',
      'Préstamo #101', 'REFINANCED', 'Préstamo #102', 'ACTIVE', '₡119.000,00', '₡31.000,00',
      '₡20.000,00', '₡170.000,00', '₡15.000,00', '₡185.000,00', 'DESEMBOLSO', 'Transferencia',
      'Ver cadena', 'Ver nuevo préstamo', 'Ver detalle del refinanciamiento', 'Nuevo refinanciamiento', 'Volver a préstamos']) expect(html).toContain(text);
    expect(html).not.toContain('₡120.000,00');
    expect(html).toContain('href="/loans/new-2"');
    expect(html).toContain('href="/loan-refinancings/ref-1"');
    expect(html).toContain('href="/loan-refinancings/chains/loan/origin-1"');
    expect(html).toContain('tabindex="-1"');
  });

  it('does not invent a cash movement when the response has no disbursement, and detail stays read-only', () => {
    const zero: RefinancingResult = { ...result, financialComposition: { ...result.financialComposition, newMoneyDisbursed: '0.00' },
      newContract: { ...result.newContract, disbursementPaymentMethod: null }, disbursement: null };
    const html = withIdentity(<RefinancingResultView result={zero} />);
    expect(html).toContain('Este refinanciamiento no generó un nuevo desembolso.');
    expect(html).not.toContain('<h2>DESEMBOLSO</h2>');
    expect(html).not.toContain('Ver detalle del refinanciamiento');
    expect(html).not.toContain('Ver nuevo préstamo');
    expect(html).toContain('Ver cadena');
    expect(html).toContain('href="/loan-refinancings/new"');
  });
});
