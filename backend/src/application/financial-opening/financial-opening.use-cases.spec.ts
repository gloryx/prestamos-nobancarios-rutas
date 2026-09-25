import { FinancialOpeningAlreadyPerformedError, FinancialOpeningValidationError } from '../../domain/financial-opening/financial-opening.errors';
import { normalizeFinancialOpeningInput, PerformFinancialOpeningUseCase } from './financial-opening.use-cases';
import type { FinancialOpeningRepository } from './financial-opening.repository';

const input = { openingDate: '2026-01-01', initialAvailableAmount: '0', initialPortfolio: '0.00', initialUncollectibleAmount: '10.5', historicalSeedCapital: '2', observations: '  inicio histórico  ' };
const opening = { id: 'opening', ...input, initialAvailableAmount: '0.00', initialPortfolio: '0.00', initialUncollectibleAmount: '10.50', historicalSeedCapital: '2.00', observations: 'INICIO HISTÓRICO', openedByUserId: 'actor', openedAt: new Date(), openedBy: { id: 'actor', fullName: 'Actor' } };
describe('financial opening use cases', () => {
  it('rejects a required date and future dates', () => {
    expect(() => normalizeFinancialOpeningInput({ ...input, openingDate: '' })).toThrow(FinancialOpeningValidationError);
    expect(() => normalizeFinancialOpeningInput({ ...input, openingDate: '2999-01-01' })).toThrow(FinancialOpeningValidationError);
    expect(() => normalizeFinancialOpeningInput({ ...input, openingDate: '2026-02-30' })).toThrow(FinancialOpeningValidationError);
  });
  it.each(['initialAvailableAmount', 'initialPortfolio', 'initialUncollectibleAmount', 'historicalSeedCapital'] as const)('rejects negative %s', (field) => {
    expect(() => normalizeFinancialOpeningInput({ ...input, [field]: '-1' })).toThrow(FinancialOpeningValidationError);
  });
  it('accepts zero values, normalizes uppercase observations and forwards actor id', async () => {
    const zeroInput = { ...input, initialAvailableAmount: '0', initialPortfolio: '0', initialUncollectibleAmount: '0', historicalSeedCapital: '0' };
    const repository: FinancialOpeningRepository = { find: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue(opening) };
    const result = await new PerformFinancialOpeningUseCase(repository).execute(zeroInput, 'actor');
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ openedByUserId: 'actor', observations: 'INICIO HISTÓRICO', initialAvailableAmount: '0.00', initialPortfolio: '0.00', initialUncollectibleAmount: '0.00', historicalSeedCapital: '0.00' })); expect(result.id).toBe('opening');
  });
  it('rejects an existing opening', async () => {
    const repository: FinancialOpeningRepository = { find: jest.fn().mockResolvedValue(opening), create: jest.fn() };
    await expect(new PerformFinancialOpeningUseCase(repository).execute(input, 'actor')).rejects.toThrow(FinancialOpeningAlreadyPerformedError);
  });
});
