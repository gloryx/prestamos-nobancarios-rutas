import { ChangePaymentFrequencyStatusUseCase, CreatePaymentFrequencyUseCase, GetPaymentFrequencyUseCase, ListPaymentFrequenciesUseCase, UpdatePaymentFrequencyUseCase } from '../src/application/payment-frequency/payment-frequency.use-cases';
import type { CreatePaymentFrequency, PaymentFrequencyRepository, UpdatePaymentFrequency } from '../src/application/payment-frequency/payment-frequency.repository';
import type { IntervalUnit, PaymentFrequency } from '../src/domain/payment-frequency/payment-frequency.types';
import { PaymentFrequencyNameAlreadyExistsError } from '../src/domain/payment-frequency/payment-frequency.errors';
import { PaymentFrequencyController } from '../src/presentation/payment-frequency/payment-frequency.controller';

const item = (id: string, name: string, unit: IntervalUnit, value: number, order: number, isActive = true): PaymentFrequency => ({ id, name, intervalUnit: unit, intervalValue: value, order, isActive, createdAt: new Date(), updatedAt: new Date() });
class FakePaymentFrequencyRepository implements PaymentFrequencyRepository {
  rows = [item('2', 'Mensual', 'MONTH', 1, 2), item('1', 'Diario', 'DAY', 1, 1)];
  async findAll() { return [...this.rows].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)); }
  async findById(id: string) { return this.rows.find((row) => row.id === id) ?? null; }
  async create(input: CreatePaymentFrequency) { const created = item('3', input.name, input.intervalUnit, input.intervalValue, input.order); this.rows.push(created); return created; }
  async update(id: string, input: UpdatePaymentFrequency) { const row = await this.findById(id); if (!row) return null; Object.assign(row, input); return row; }
  async updateStatus(id: string, isActive: boolean) { const row = await this.findById(id); if (!row) return null; row.isActive = isActive; return row; }
}

describe('payment frequency use cases', () => {
  it('lists by order and gets an item', async () => { const repository = new FakePaymentFrequencyRepository(); expect((await new ListPaymentFrequenciesUseCase(repository).execute()).map((row) => row.name)).toEqual(['Diario', 'Mensual']); expect((await new GetPaymentFrequencyUseCase(repository).execute('1')).intervalUnit).toBe('DAY'); });
  it('creates and updates interval values', async () => { const repository = new FakePaymentFrequencyRepository(); const created = await new CreatePaymentFrequencyUseCase(repository).execute({ name: '  Quincenal  ', intervalUnit: 'DAY', intervalValue: 15, order: 3 }); expect(created.name).toBe('Quincenal'); await new UpdatePaymentFrequencyUseCase(repository).execute(created.id, { intervalValue: 30, order: 4 }); expect((await repository.findById(created.id))?.intervalValue).toBe(30); });
  it('deactivates and reactivates without deleting', async () => { const repository = new FakePaymentFrequencyRepository(); const useCase = new ChangePaymentFrequencyStatusUseCase(repository); await useCase.execute('1', false); expect((await repository.findById('1'))?.isActive).toBe(false); await useCase.execute('1', true); expect((await repository.findById('1'))?.isActive).toBe(true); expect(repository.rows).toHaveLength(2); });
  it('keeps duplicate names as a conflict and exposes no delete operation', () => { expect(new PaymentFrequencyNameAlreadyExistsError().message).toContain('already exists'); expect(Object.getOwnPropertyNames(PaymentFrequencyController.prototype)).not.toContain('deleteOne'); });
  it('requires positive integer values and supported interval units at the API boundary', async () => { const { validate } = await import('class-validator'); const { plainToInstance } = await import('class-transformer'); const { CreatePaymentFrequencyDto } = await import('../src/presentation/payment-frequency/payment-frequency.dto'); const invalid = plainToInstance(CreatePaymentFrequencyDto, { name: ' ', intervalUnit: 'YEAR', intervalValue: 0, order: 0 }); expect((await validate(invalid)).length).toBeGreaterThan(0); });
});
