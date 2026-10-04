import type { RefinancingOperation } from '../../application/loan-refinancing/refinancing.port';

export function refinancingResponse(operation: RefinancingOperation) {
  return {
    refinancingId: operation.id,
    originLoan: { id: operation.originLoanId, loanNumber: operation.originLoanNumber,
      status: operation.originStatus, startDate: operation.originStartDate },
    newLoan: { id: operation.newLoanId, loanNumber: operation.newLoanNumber,
      status: operation.newStatus, startDate: operation.newStartDate },
    customer: { id: operation.customerId, fullName: operation.customerName,
      identification: operation.customerIdentification },
    financialComposition: {
      outstandingPrincipalTransferred: operation.outstandingPrincipalTransferred,
      capitalizedOutstandingInterest: operation.capitalizedOutstandingInterest,
      newMoneyDisbursed: operation.newMoneyDisbursed,
      newContractualPrincipal: operation.newContractualPrincipal,
      newInterestAmount: operation.newInterestAmount,
      newContractualTotal: operation.newContractualTotal,
    },
    newContract: {
      paymentFrequency: { id: operation.paymentFrequencyId, name: operation.paymentFrequencyName,
        intervalUnit: operation.intervalUnit, intervalValue: operation.intervalValue },
      preferredPaymentMethod: { id: operation.preferredPaymentMethodId, name: operation.preferredPaymentMethodName },
      disbursementPaymentMethod: operation.disbursementId ?
        { id: operation.disbursementMethodId, name: operation.disbursementPaymentMethodName } : null,
      observations: operation.observations,
    },
    disbursement: operation.disbursementId ? { id: operation.disbursementId, cashMovementId: operation.cashMovementId } : null,
    refinancingDate: operation.refinancingDate, createdAt: operation.createdAt,
    createdBy: { id: operation.createdByUserId, fullName: operation.createdByName },
  };
}
