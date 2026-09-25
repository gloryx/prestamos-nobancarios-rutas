import 'reflect-metadata';
import { PERMISSIONS_KEY } from '../src/presentation/security/security.decorators';
import { FinancialOpeningController } from '../src/presentation/financial-opening/financial-opening.controller';
import { FinancialOpeningAlreadyPerformedError, FinancialOpeningValidationError } from '../src/domain/financial-opening/financial-opening.errors';

describe('financial opening controller boundary', () => {
  it('exposes only guarded GET and POST and removes internal actor id from output', async () => {
    const opening = { id: 'id', openingDate: '2026-01-01', initialAvailableAmount: '0.00', initialPortfolio: '1.00', initialUncollectibleAmount: '2.00', historicalSeedCapital: '3.00', observations: null, openedByUserId: 'secret', openedAt: new Date(), openedBy: { id: 'user', fullName: 'User' } };
    const controller = new FinancialOpeningController({ execute: jest.fn().mockResolvedValue(opening) } as never, {} as never);
    const response = await controller.getOpening();
    expect(response.opening).not.toHaveProperty('openedByUserId');
    expect(Reflect.getMetadata(PERMISSIONS_KEY, FinancialOpeningController.prototype.getOpening)).toEqual(['financial-opening.view']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, FinancialOpeningController.prototype.performOpening)).toEqual(['financial-opening.perform']);
    expect(Object.getOwnPropertyNames(FinancialOpeningController.prototype)).not.toEqual(expect.arrayContaining(['updateOpening', 'deleteOpening']));
  });

  it('maps known validation and singleton errors while rethrowing unexpected errors', async () => {
    const body = { openingDate: '2026-01-01', initialAvailableAmount: '0', initialPortfolio: '0', initialUncollectibleAmount: '0', historicalSeedCapital: '0' };
    const actor = { id: 'actor' } as never;
    const validation = new FinancialOpeningController({} as never, { execute: jest.fn().mockRejectedValue(new FinancialOpeningValidationError('invalid')) } as never);
    await expect(validation.performOpening(body, actor)).rejects.toMatchObject({ status: 400, message: 'invalid' });
    const conflict = new FinancialOpeningController({} as never, { execute: jest.fn().mockRejectedValue(new FinancialOpeningAlreadyPerformedError()) } as never);
    await expect(conflict.performOpening(body, actor)).rejects.toMatchObject({ status: 409, message: 'La apertura financiera ya fue realizada.' });
    const unexpected = new Error('database unavailable');
    const controller = new FinancialOpeningController({} as never, { execute: jest.fn().mockRejectedValue(unexpected) } as never);
    await expect(controller.performOpening(body, actor)).rejects.toBe(unexpected);
  });
});
