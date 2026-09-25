import { QueryFailedError, Repository } from 'typeorm';
import { PaymentFrequencyNameAlreadyExistsError } from '../../../../domain/payment-frequency/payment-frequency.errors';
import type { PaymentFrequency } from '../../../../domain/payment-frequency/payment-frequency.types';
import type { CreatePaymentFrequency, PaymentFrequencyRepository, UpdatePaymentFrequency } from '../../../../application/payment-frequency/payment-frequency.repository';
import { PaymentFrequencyOrmEntity } from '../entities';

export class PaymentFrequencyTypeOrmRepository implements PaymentFrequencyRepository {
  constructor(private readonly repository: Repository<PaymentFrequencyOrmEntity>) {}
  private map(row: PaymentFrequencyOrmEntity): PaymentFrequency { return { id: row.id, name: row.name, intervalUnit: row.intervalUnit, intervalValue: row.intervalValue, order: row.displayOrder, isActive: row.isActive, createdAt: row.createdAt, updatedAt: row.updatedAt }; }
  async findAll(): Promise<PaymentFrequency[]> { const rows = await this.repository.createQueryBuilder('frequency').orderBy('frequency.display_order', 'ASC').addOrderBy('frequency.name', 'ASC').getMany(); return rows.map((row) => this.map(row)); }
  async findById(id: string): Promise<PaymentFrequency | null> { const row = await this.repository.findOneBy({ id }); return row ? this.map(row) : null; }
  async create(input: CreatePaymentFrequency): Promise<PaymentFrequency> { try { return this.map(await this.repository.save(this.repository.create({ name: input.name, intervalUnit: input.intervalUnit, intervalValue: input.intervalValue, displayOrder: input.order, isActive: true }))); } catch (error) { this.throwDuplicate(error); throw error; } }
  async update(id: string, input: UpdatePaymentFrequency): Promise<PaymentFrequency | null> { try { const row = await this.repository.preload({ id, ...(input.name === undefined ? {} : { name: input.name }), ...(input.intervalUnit === undefined ? {} : { intervalUnit: input.intervalUnit }), ...(input.intervalValue === undefined ? {} : { intervalValue: input.intervalValue }), ...(input.order === undefined ? {} : { displayOrder: input.order }) }); return row ? this.map(await this.repository.save(row)) : null; } catch (error) { this.throwDuplicate(error); throw error; } }
  async updateStatus(id: string, isActive: boolean): Promise<PaymentFrequency | null> { const row = await this.repository.preload({ id, isActive }); return row ? this.map(await this.repository.save(row)) : null; }
  private throwDuplicate(error: unknown): void { if (error instanceof QueryFailedError && (error as { driverError?: { code?: string } }).driverError?.code === '23505') throw new PaymentFrequencyNameAlreadyExistsError(); }
}
