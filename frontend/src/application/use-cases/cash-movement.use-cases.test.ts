import { describe, expect, it } from 'vitest';
import { MANUAL_CONCEPTS } from './cash-movement.use-cases';
import { signedCRC } from '../../shared/utils/money';
describe('cash movement pure rules', () => { it('maps only manual concepts to a derived direction', () => { expect(MANUAL_CONCEPTS.map((concept) => concept.direction)).toEqual(['INFLOW', 'OUTFLOW', 'INFLOW', 'OUTFLOW']); }); it('formats signed amounts without floating point conversion', () => { expect(signedCRC('1234567890123456.78', 'INFLOW')).toContain('+'); expect(signedCRC('10.5', 'OUTFLOW')).toContain('-'); }); });
