import type { LoanEditContext } from '../../domain/entities/loan';

export const editContext: LoanEditContext = {
  loan: { id: 'loan-1', loanNumber: '42', customer: { id: 'customer', identification: '101', fullName: 'Ana' }, status: 'ACTIVE',
    principal: '100.00', interestAmount: '20.00', totalAmount: '120.00', startDate: '2026-01-01',
    paymentFrequencyId: 'frequency-old', paymentFrequencyName: 'Antigua', preferredPaymentMethodId: 'method-old',
    preferredPaymentMethodName: 'Anterior', observations: 'ORIGINAL' },
  baseline: { interestAmount: '20.00', paymentFrequencyId: 'frequency-old', preferredPaymentMethodId: 'method-old', observations: 'ORIGINAL', financialBalance: '60.00',
    plan: [{ id: 'plan-a', dueDate: '2026-02-01', pendingAmount: '60.00' }] },
  paymentFrequencyOptions: [{ id: 'frequency-old', name: 'Antigua', active: false }, { id: 'frequency-new', name: 'Nueva', active: true }, { id: 'frequency-off', name: 'Otra', active: false }],
  preferredPaymentMethodOptions: [{ id: 'method-old', name: 'Anterior', active: false }, { id: 'method-new', name: 'Actual', active: true }, { id: 'method-off', name: 'Otra', active: false }],
};
