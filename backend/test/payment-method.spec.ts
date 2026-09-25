import { ChangePaymentMethodStatusUseCase, CreatePaymentMethodUseCase, ListPaymentMethodsUseCase, UpdatePaymentMethodUseCase } from '../src/application/payment-method/payment-method.use-cases';
import type { PaymentMethodRepository } from '../src/application/payment-method/payment-method.repository';
import type { PaymentMethod } from '../src/domain/payment-method/payment-method.types';

const item = (id: string, name: string, order: number, isActive = true): PaymentMethod => ({ id, name, order, isActive, createdAt: new Date(), updatedAt: new Date() });
class FakePaymentMethodRepository implements PaymentMethodRepository {
  rows = [item('2', 'Transferencia', 3), item('1', 'Efectivo', 1)];
  async findAll() { return [...this.rows].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)); }
  async findById(id: string) { return this.rows.find((row) => row.id === id) ?? null; }
  async create(input: { name: string; order: number }) { const created = item('3', input.name, input.order); this.rows.push(created); return created; }
  async update(id: string, input: { name?: string; order?: number }) { const row = await this.findById(id); if (!row) return null; Object.assign(row, input); return row; }
  async updateStatus(id: string, isActive: boolean) { const row = await this.findById(id); if (!row) return null; row.isActive = isActive; return row; }
}

describe('payment method use cases', () => {
  it('lists by order then name', async () => { const repository = new FakePaymentMethodRepository(); expect((await new ListPaymentMethodsUseCase(repository).execute()).map((row) => row.name)).toEqual(['Efectivo', 'Transferencia']); });
  it('creates and updates payment methods', async () => { const repository = new FakePaymentMethodRepository(); const created = await new CreatePaymentMethodUseCase(repository).execute({ name: '  SINPE Móvil  ', order: 2 }); expect(created.name).toBe('SINPE Móvil'); await new UpdatePaymentMethodUseCase(repository).execute(created.id, { name: 'SINPE', order: 4 }); expect((await repository.findById(created.id))?.order).toBe(4); });
  it('deactivates and reactivates without deleting', async () => { const repository = new FakePaymentMethodRepository(); const useCase = new ChangePaymentMethodStatusUseCase(repository); await useCase.execute('1', false); expect((await repository.findById('1'))?.isActive).toBe(false); await useCase.execute('1', true); expect((await repository.findById('1'))?.isActive).toBe(true); expect(repository.rows).toHaveLength(2); });
});
