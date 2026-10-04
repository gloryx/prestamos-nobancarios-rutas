import { describe, expect, it, vi } from 'vitest';
import type { LoanRefinancingOptions } from '../ports/loan-refinancing.repository';
import type { RefinancingPreview } from '../../domain/entities/loan-refinancing';
import type { PaymentFrequency } from '../../domain/entities/payment-frequency';
import type { PaymentMethod } from '../../domain/entities/payment-method';
import { RefinancingConditionsController } from './refinancing-conditions-controller';
import { evaluateRefinancingConditions, type RefinancingConditions } from './refinancing-conditions';

const preview: RefinancingPreview = {
  loanId: 'loan-1', loanNumber: '100', customer: { id: 'customer-1', name: 'Ana', identification: '123' },
  status: 'ACTIVE', startDate: '2026-09-01', principal: '150000.00', interestAmount: '30000.00',
  totalAmount: '180000.00', paidAmount: '30000.00', paidPrincipal: '30000.00', paidInterest: '0.00',
  outstandingPrincipal: '120000.00', outstandingInterest: '30000.00', financialBalance: '150000.00',
  pendingPlanAmount: '150000.00', minimumRequiredPayment: '30000.00', remainingToMinimum: '0.00',
  eligible: true, reasonCode: null, reason: null, reasons: [], baseline: 'a'.repeat(64),
};
const frequency: PaymentFrequency = { id: 'daily', name: 'Diaria', intervalUnit: 'DAY', intervalValue: 1, order: 1, isActive: true };
const method: PaymentMethod = { id: 'cash', name: 'Efectivo', order: 1, isActive: true };
const conditions: RefinancingConditions = {
  refinancingDate: '2026-10-01', newMoney: '20000.00', newInterestAmount: '10000.00',
  disbursementPaymentMethodId: 'cash', paymentFrequencyId: 'daily', preferredPaymentMethodId: 'cash',
  observations: '', count: '3', mode: 'automatic', customPlan: [],
};

describe('refinancing conditions', () => {
  it('capitalizes only the outstanding old interest, adds only new interest to the total and distributes exact cents', () => {
    const draft = evaluateRefinancingConditions(preview, conditions, frequency, [method.id], '2026-10-02');
    expect(draft).toMatchObject({ principal: '170000.00', total: '180000.00', difference: 0n, valid: true });
    expect(draft.plan).toEqual([
      { sequence: 1, dueDate: '2026-10-02', pendingAmount: '60000.00' },
      { sequence: 2, dueDate: '2026-10-03', pendingAmount: '60000.00' },
      { sequence: 3, dueDate: '2026-10-05', pendingAmount: '60000.00' },
    ]);
    expect(evaluateRefinancingConditions(preview, { ...conditions, newMoney: '0.00',
      disbursementPaymentMethodId: '', newInterestAmount: '0.01', count: '2' }, frequency, [method.id], '2026-10-02'))
      .toMatchObject({ principal: '150000.00', total: '150000.01', difference: 0n, valid: true,
        plan: [{ pendingAmount: '75000.00' }, { pendingAmount: '75000.01' }] });
  });

  it('rejects invalid dates, missing cash method, nonpositive rows, incorrect totals and excessive amounts', () => {
    const evaluate = (changes: Partial<RefinancingConditions>) =>
      evaluateRefinancingConditions(preview, { ...conditions, ...changes }, frequency, [method.id], '2026-10-02');
    expect(evaluate({ refinancingDate: '2026-10-03' }).dateValid).toBe(false);
    expect(evaluate({ refinancingDate: '2026-02-30' }).dateValid).toBe(false);
    expect(evaluate({ disbursementPaymentMethodId: '' }).methodsValid).toBe(false);
    expect(evaluate({ count: '18000001' }).countValid).toBe(false);
    expect(evaluate({ newMoney: '9999999999999999.99' }).amountsValid).toBe(false);
    const generated = evaluate({}).plan;
    const badPlan = (rows: typeof generated) => evaluate({ mode: 'personalized', customPlan: rows });
    expect(badPlan([{ ...generated[0], pendingAmount: '0.00' }, ...generated.slice(1)]).planValid).toBe(false);
    expect(badPlan([{ ...generated[0], dueDate: conditions.refinancingDate }, ...generated.slice(1)]).planValid).toBe(false);
    expect(badPlan([generated[0], { ...generated[1], dueDate: generated[0].dueDate }, generated[2]]).planValid).toBe(false);
    expect(badPlan([{ ...generated[0], dueDate: '2026-10-04' }, ...generated.slice(1)]))
      .toMatchObject({ planValid: false, planDateIssue: 'sunday' });
    expect(badPlan([generated[1], generated[0], generated[2]]))
      .toMatchObject({ planValid: false, planDateIssue: 'order' });
    expect(badPlan([{ ...generated[0], pendingAmount: '60000.01' }, ...generated.slice(1)]))
      .toMatchObject({ difference: -1n, valid: false });
    expect(evaluateRefinancingConditions({ ...preview, eligible: false }, conditions, frequency, [method.id], '2026-10-02').valid).toBe(false);
  });

  it('loads only active options, preserves manual edits, resets on a new baseline and retries option errors', async () => {
    const options: LoanRefinancingOptions = { load: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({
      frequencies: [frequency, { ...frequency, id: 'inactive', isActive: false }],
      methods: [method, { ...method, id: 'inactive', isActive: false }],
    }) };
    const controller = new RefinancingConditionsController(options);
    controller.setPreview(preview);
    controller.setMode('personalized');
    expect(controller.getSnapshot().conditions.mode).toBe('automatic');
    await controller.loadOptions();
    expect(controller.getSnapshot()).toMatchObject({ optionsLoaded: false, loadingOptions: false, optionsError: expect.any(Error) });
    expect(controller.canProceed()).toBe(false);
    await controller.loadOptions();
    expect(controller.getSnapshot().frequencies.map((item) => item.id)).toEqual(['daily']);
    expect(controller.getSnapshot().methods.map((item) => item.id)).toEqual(['cash']);
    controller.setConditions(conditions);
    expect(controller.canProceed()).toBe(true);
    controller.setMode('personalized');
    controller.setCustomPlan([{ ...controller.evaluate()!.plan[0], pendingAmount: '1.00' }]);
    expect(controller.canProceed()).toBe(false);
    controller.setConditions({ newMoney: '0' });
    expect(controller.getSnapshot().conditions.disbursementPaymentMethodId).toBe('');
    controller.setPreview(preview);
    expect(controller.getSnapshot().conditions.mode).toBe('personalized');
    controller.setPreview({ ...preview, baseline: 'b'.repeat(64) });
    expect(controller.getSnapshot().conditions).toMatchObject({ mode: 'automatic', newMoney: '0.00', customPlan: [] });
    expect(controller.getSnapshot().optionsLoaded).toBe(true);
    controller.dispose();
  });
});
