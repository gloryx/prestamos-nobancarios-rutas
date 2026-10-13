import { CashMovementController } from '../src/presentation/cash-movement/cash-movement.controller';
import { CashMovementConflictError, CashMovementValidationError } from '../src/domain/cash-movement/cash-movement.errors';

describe('CashMovementController list projection', () => {
  const movement = {
    id: 'movement-1', direction: 'INFLOW', concept: 'CUSTOMER_PAYMENT', amount: '25.00', movementDate: '2026-01-01',
    paymentMethod: { id: 'pm', name: 'Cash', isActive: true }, observations: null, reversedMovementId: null,
    createdBy: { id: 'actor', fullName: 'Actor' }, createdAt: new Date('2026-01-01'),
    loanNumber: '125', reversedConcept: 'LOAN_DISBURSEMENT', paymentId: 'secret-payment-id', loanDisbursementId: 'secret-disbursement-id',
  };
  const base = {
    id: movement.id, direction: movement.direction, concept: movement.concept, amount: movement.amount,
    movementDate: movement.movementDate, paymentMethod: movement.paymentMethod, observations: movement.observations,
    reversedMovementId: movement.reversedMovementId, createdBy: movement.createdBy, createdAt: movement.createdAt,
  };
  const list = { execute: jest.fn().mockResolvedValue({ items: [movement, { ...movement, id: 'legacy', loanNumber: undefined, reversedConcept: undefined }], total: 35 }) };
  const create = { execute: jest.fn().mockResolvedValue(movement) };
  const reverse = { execute: jest.fn().mockResolvedValue(movement) };
  const controller = new CashMovementController(list as never, {} as never, create as never, reverse as never);

  it('adds nullable metadata only to GET list items, without leaking persistence IDs', async () => {
    const response = await controller.getList({ page: 2, pageSize: 20 });
    expect(list.execute).toHaveBeenCalledWith(expect.objectContaining({ page: 2, pageSize: 20 }));
    expect(response).toEqual({ page: 2, pageSize: 20, total: 35, items: [
      { ...base, loanNumber: '125', reversedConcept: 'LOAN_DISBURSEMENT' },
      { ...base, id: 'legacy', loanNumber: null, reversedConcept: null },
    ] });
  });

  it('keeps manual create and reverse response shapes unchanged', async () => {
    expect(await controller.createMovement({} as never, { id: 'actor' } as never)).toEqual(base);
    expect(await controller.reverseMovement('movement-1', {} as never, { id: 'actor' } as never)).toEqual(base);
  });

  it('publishes stable financial reason codes and field metadata', async () => {
    create.execute.mockRejectedValueOnce(new CashMovementConflictError('Closed', 'CLOSED_FINANCIAL_PERIOD'));
    await expect(controller.createMovement({} as never, { id: 'actor' } as never)).rejects.toMatchObject({
      response: { errorCode: 'CLOSED_FINANCIAL_PERIOD', reasonCode: 'CLOSED_FINANCIAL_PERIOD' },
    });
    create.execute.mockRejectedValueOnce(new CashMovementValidationError('Inactive', 'PAYMENT_METHOD_INACTIVE', 'paymentMethodId'));
    await expect(controller.createMovement({} as never, { id: 'actor' } as never)).rejects.toMatchObject({
      response: { reasonCode: 'PAYMENT_METHOD_INACTIVE', data: { fields: [expect.objectContaining({ field: 'paymentMethodId' })] } },
    });
  });
});
