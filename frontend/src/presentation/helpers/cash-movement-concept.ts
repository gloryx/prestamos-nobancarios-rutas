import { CASH_MOVEMENT_CONCEPT_LABELS, type CashMovement } from '../../domain/entities/cash-movement';

export function formatCashMovementTableConcept(item: Pick<CashMovement, 'concept' | 'loanNumber' | 'reversedConcept'>): string {
  const number = item.loanNumber;
  if (typeof number !== 'string' || !/^[1-9]\d*$/.test(number)) return CASH_MOVEMENT_CONCEPT_LABELS[item.concept];
  if (item.concept === 'LOAN_DISBURSEMENT') return `Desembolso de préstamo #${number}`;
  if (item.concept === 'CUSTOMER_PAYMENT') return `Pago de préstamo #${number}`;
  if (item.concept === 'REVERSAL' && item.reversedConcept === 'CUSTOMER_PAYMENT') return `Reversión de pago de préstamo #${number}`;
  if (item.concept === 'REVERSAL' && item.reversedConcept === 'LOAN_DISBURSEMENT') return `Reversión de desembolso de préstamo #${number}`;
  return CASH_MOVEMENT_CONCEPT_LABELS[item.concept];
}
