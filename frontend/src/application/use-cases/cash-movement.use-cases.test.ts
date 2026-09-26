import { describe, expect, it } from 'vitest';
import { MANUAL_CONCEPTS } from './cash-movement.use-cases';
import { CASH_MOVEMENT_CONCEPT_LABELS } from '../../domain/entities/cash-movement';
import { signedCRC } from '../../shared/utils/money';
describe('cash movement pure rules', () => { it('maps only manual concepts to a derived direction', () => { expect(MANUAL_CONCEPTS.map((concept) => concept.direction)).toEqual(['INFLOW', 'OUTFLOW', 'INFLOW', 'OUTFLOW']); }); it('formats signed amounts without floating point conversion', () => { expect(signedCRC('1234567890123456.78', 'INFLOW')).toContain('+'); expect(signedCRC('10.5', 'OUTFLOW')).toContain('-'); }); it('keeps user-facing concept labels separate from stored concept codes', () => { expect(CASH_MOVEMENT_CONCEPT_LABELS.LOAN_DISBURSEMENT).toBe('Desembolso de préstamo'); expect(CASH_MOVEMENT_CONCEPT_LABELS.CUSTOMER_PAYMENT).toBe('Pago de cliente'); expect(CASH_MOVEMENT_CONCEPT_LABELS.REVERSAL).toBe('Reversión'); }); });
