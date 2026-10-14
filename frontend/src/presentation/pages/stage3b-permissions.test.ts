import { describe, expect, it, vi } from 'vitest';
import type { CollectorPrecollectionDetail } from '../../domain/entities/collector-precollection';
import { custodyOperationsFor, precollectionActions, settlementActionsFor } from '../helpers/stage3b-actions';

const precollection = (status: CollectorPrecollectionDetail['status']): CollectorPrecollectionDetail => ({
  id: 'p1', receiptNumber: 'CP-000000000001', collectorId: 'c1', collectorUserId: 'u1', customerId: 'customer', loanId: 'loan', routeId: 'route',
  customerRouteAssignmentId: 'cra', collectorRouteAssignmentId: 'coa', paymentMethodId: 'cash', custodyTreatment: 'COLLECTOR_HELD',
  amount: '10.00', customerBalanceBefore: '100.00', customerBalanceAfter: '90.00', effectiveDate: '2026-10-12',
  reference: null, notes: null, status, recordedByUserId: 'u1',
  recordedAt: '2026-10-12T10:00:00Z', cancelledByUserId: null, cancelledAt: null, cancellationReason: null,
  collectorName: 'Collector', customerName: 'Customer', customerIdentification: '1', customerPhone: '88888888', customerSecondaryPhone: null,
  loanNumber: 'L-1', routeName: 'R', paymentMethodName: 'Cash', recordedByName: 'Collector', cancelledByName: null,
  financialBalance: '100.00', reservedPrecollections: '10.00', operationalBalance: '90.00',
});

describe('Stage 3B permission and lifecycle actions', () => {
  it('offers precollection cancellation only for RECORDED and only with permission', () => {
    expect(precollectionActions(precollection('RECORDED'), true, vi.fn(), vi.fn()).map((item) => item.key)).toEqual(['view', 'cancel']);
    expect(precollectionActions(precollection('SUBMITTED'), true, vi.fn(), vi.fn()).map((item) => item.key)).toEqual(['view']);
    expect(precollectionActions(precollection('RECORDED'), false, vi.fn(), vi.fn()).map((item) => item.key)).toEqual(['view']);
  });

  it('never exposes review or confirm through collector settlement actions', () => {
    const allowAll = () => true;
    expect(settlementActionsFor('DRAFT', true, allowAll)).toEqual(['submit', 'cancel']);
    expect(settlementActionsFor('UNDER_REVIEW', true, allowAll)).toEqual([]);
    expect(settlementActionsFor('UNDER_REVIEW', false, allowAll)).toEqual(['confirm', 'reject']);
  });

  it('limits collector custody mutations to own remittance and never defines disbursement', () => {
    expect(custodyOperationsFor(true, () => true).map((item) => item.operation)).toEqual(['remit']);
    expect(custodyOperationsFor(false, () => true).map((item) => item.operation)).toEqual(['remit', 'topUp', 'adjust']);
    expect(JSON.stringify(custodyOperationsFor(false, () => true))).not.toContain('disbursement');
  });
});
