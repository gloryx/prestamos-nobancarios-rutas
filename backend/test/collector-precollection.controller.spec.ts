import 'reflect-metadata';
import { CollectorPrecollectionConflictError, CollectorPrecollectionValidationError } from '../src/domain/collector-precollection/collector-precollection.errors';
import { CollectorPrecollectionController } from '../src/presentation/collector-precollection/collector-precollection.controller';
import { PERMISSIONS_KEY } from '../src/presentation/security/security.decorators';

const identity = { id: 'actor' } as never;

describe('collector precollection controller boundary', () => {
  it('publishes separate create, assigned, global and cancel permissions with dynamic detail scope', () => {
    const prototype = CollectorPrecollectionController.prototype;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, prototype.create)).toEqual(['collector-precollections.create']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, prototype.mine)).toEqual(['collector-precollections.assigned.view']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, prototype.list)).toEqual(['collector-precollections.view']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, prototype.detail)).toEqual([]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, prototype.cancel)).toEqual(['collector-precollections.cancel']);
  });

  it('does not accept a collector id in the create contract and forwards the authenticated actor', async () => {
    const create = { execute: jest.fn().mockResolvedValue({ id: 'precollection' }) };
    const controller = new CollectorPrecollectionController(create as never, {} as never, {} as never, {} as never, {} as never);
    const body = { customerId: 'customer', loanId: 'loan', paymentMethodId: 'method', custodyTreatment: 'COLLECTOR_HELD' as const, amount: '1.00',
      effectiveDate: '2026-10-12', idempotencyKey: 'key' };
    await expect(controller.create(body, identity)).resolves.toEqual({ id: 'precollection' });
    expect(create.execute).toHaveBeenCalledWith(body, identity);
    expect(body).not.toHaveProperty('collectorId');
  });

  it('maps validation and conflict errors to structured HTTP responses', async () => {
    const validation = new CollectorPrecollectionController({ execute: jest.fn().mockRejectedValue(
      new CollectorPrecollectionValidationError('Invalid amount', 'AMOUNT_INVALID', 'amount')) } as never,
    {} as never, {} as never, {} as never, {} as never);
    await expect(validation.create({} as never, identity)).rejects.toMatchObject({ status: 400,
      response: { errorCode: 'VALIDATION_FAILED', reasonCode: 'AMOUNT_INVALID', data: { fields: [{ field: 'amount' }] } } });
    const conflict = new CollectorPrecollectionController({} as never, {} as never, {} as never, {} as never,
      { execute: jest.fn().mockRejectedValue(new CollectorPrecollectionConflictError('Already cancelled', 'PRECOLLECTION_NOT_CANCELLABLE')) } as never);
    await expect(conflict.cancel('id', { reason: 'reason', idempotencyKey: 'key' }, identity)).rejects.toMatchObject({ status: 409,
      response: { errorCode: 'RESOURCE_STATE_CONFLICT', reasonCode: 'PRECOLLECTION_NOT_CANCELLABLE' } });
  });
});
