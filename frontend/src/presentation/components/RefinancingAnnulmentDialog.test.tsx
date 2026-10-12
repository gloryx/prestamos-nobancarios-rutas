import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RefinancingAnnulmentAttempt } from '../../application/use-cases/refinancing-annulment-controller';
import type { RefinancingAnnulmentCandidate } from '../../domain/entities/loan-refinancing';
import { RefinancingAnnulmentDialog } from './RefinancingAnnulmentDialog';

const candidate: RefinancingAnnulmentCandidate = { refinancingId: 'ref-1', refinancingDate: '2026-10-01', originLoanId: 'origin-1',
  originLoanNumber: '100', successorLoanId: 'successor-1', successorLoanNumber: '101',
  customer: { id: 'customer-1', fullName: 'Ana Solís', identification: '1' },
  outstandingPrincipalTransferred: '80.00', capitalizedOutstandingInterest: '20.00', newMoneyDisbursed: '50.00',
  newContractualTotal: '150.00', eligibility: { eligible: true, reasons: [], types: {
    DATA_CORRECTION: { eligible: true, requiresEffectiveDate: false, reasons: [] },
    CASH_REFUND: { eligible: true, requiresEffectiveDate: true, reasons: [] },
  } } };
const attempt = (type: 'DATA_CORRECTION' | 'CASH_REFUND'): RefinancingAnnulmentAttempt => ({ candidate, type,
  effectiveDate: type === 'CASH_REFUND' ? '2026-10-10' : '',
  validatedEffectiveDate: type === 'CASH_REFUND' ? '2026-10-10' : null, eligibility: candidate.eligibility,
  refundPaymentMethodId: type === 'CASH_REFUND' ? 'cash' : '', resolutionConfirmed: false,
  reason: 'Motivo suficiente', key: null, validating: false, submitting: false, error: null });
const props = { methods: [{ id: 'cash', name: 'Efectivo' }], onType: vi.fn(), onReason: vi.fn(),
  onEffectiveDate: vi.fn(), onValidateDate: vi.fn(), onRefundMethod: vi.fn(), onResolutionConfirmed: vi.fn(),
  onSubmit: vi.fn(), onClose: vi.fn() };

describe('RefinancingAnnulmentDialog', () => {
  it('describes DATA_CORRECTION as a non-delivery attestation instead of a physical refund', () => {
    const html = renderToStaticMarkup(<RefinancingAnnulmentDialog {...props} attempt={attempt('DATA_CORRECTION')} />);
    expect(html).toContain('el dinero nuevo no fue entregado');
    expect(html).toContain('no se recibió una devolución física');
    expect(html).not.toContain('Método de recepción');
    expect(html).toContain('disabled=""');
  });

  it('requires the physical receipt wording and method for CASH_REFUND', () => {
    const html = renderToStaticMarkup(<RefinancingAnnulmentDialog {...props} attempt={attempt('CASH_REFUND')} />);
    expect(html).toContain('Método de recepción');
    expect(html).toContain('fue devuelto íntegramente y recibido por el método indicado');
  });
});
