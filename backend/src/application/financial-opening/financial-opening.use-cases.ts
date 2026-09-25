import { FinancialOpeningAlreadyPerformedError, FinancialOpeningValidationError } from '../../domain/financial-opening/financial-opening.errors';
import type { FinancialOpening } from '../../domain/financial-opening/financial-opening.types';
import type { CreateFinancialOpening, FinancialOpeningRepository } from './financial-opening.repository';

const AMOUNT_FIELDS = ['initialAvailableAmount', 'initialPortfolio', 'initialUncollectibleAmount', 'historicalSeedCapital'] as const;
type OpeningInput = Omit<CreateFinancialOpening, 'openedByUserId' | 'observations'> & { observations?: string | null };
const isAmount = (value: unknown): value is string => typeof value === 'string' && /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(value.trim());
const money = (value: string): string => `${value.trim().split('.')[0]}.${(value.trim().split('.')[1] ?? '').padEnd(2, '0')}`;

export function normalizeFinancialOpeningInput(input: OpeningInput): OpeningInput {
  const parsedDate = typeof input.openingDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.openingDate) ? new Date(`${input.openingDate}T00:00:00Z`) : null;
  if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== input.openingDate) throw new FinancialOpeningValidationError('La fecha de apertura debe tener formato YYYY-MM-DD.');
  if (input.openingDate > new Date().toISOString().slice(0, 10)) throw new FinancialOpeningValidationError('La fecha de apertura no puede ser futura.');
  for (const field of AMOUNT_FIELDS) if (!isAmount(input[field])) throw new FinancialOpeningValidationError(`El importe ${field} es requerido y debe ser un decimal no negativo de hasta 2 decimales.`);
  return { ...input, ...Object.fromEntries(AMOUNT_FIELDS.map((field) => [field, money(input[field])])), observations: input.observations?.trim().toUpperCase() || null } as OpeningInput;
}

export class GetFinancialOpeningUseCase { constructor(private readonly repository: FinancialOpeningRepository) {} execute(): Promise<FinancialOpening | null> { return this.repository.find(); } }
export class PerformFinancialOpeningUseCase {
  constructor(private readonly repository: FinancialOpeningRepository) {}
  async execute(input: OpeningInput, actorId: string): Promise<FinancialOpening> {
    const existing = await this.repository.find(); if (existing) throw new FinancialOpeningAlreadyPerformedError();
    const normalized = normalizeFinancialOpeningInput(input);
    return this.repository.create({ ...normalized, observations: normalized.observations ?? null, openedByUserId: actorId });
  }
}
