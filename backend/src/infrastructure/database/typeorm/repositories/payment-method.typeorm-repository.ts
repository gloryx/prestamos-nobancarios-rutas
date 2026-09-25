import { QueryFailedError, Repository } from 'typeorm';
import { PaymentMethodNameAlreadyExistsError } from '../../../../domain/payment-method/payment-method.errors';
import type { PaymentMethod } from '../../../../domain/payment-method/payment-method.types';
import type { CreatePaymentMethod, PaymentMethodRepository, UpdatePaymentMethod } from '../../../../application/payment-method/payment-method.repository';
import { PaymentMethodOrmEntity } from '../entities';

export class PaymentMethodTypeOrmRepository implements PaymentMethodRepository {
  constructor(private readonly repository: Repository<PaymentMethodOrmEntity>) {}
  private map(row: PaymentMethodOrmEntity): PaymentMethod { return { id: row.id, name: row.name, order: row.displayOrder, isActive: row.isActive, createdAt: row.createdAt, updatedAt: row.updatedAt }; }
  async findAll(): Promise<PaymentMethod[]> { const rows = await this.repository.createQueryBuilder('method').orderBy('method.display_order', 'ASC').addOrderBy('method.name', 'ASC').getMany(); return rows.map((row) => this.map(row)); }
  async findById(id: string): Promise<PaymentMethod | null> { const row = await this.repository.findOneBy({ id }); return row ? this.map(row) : null; }
  async create(input: CreatePaymentMethod): Promise<PaymentMethod> { try { return this.map(await this.repository.save(this.repository.create({ name: input.name, displayOrder: input.order, isActive: true }))); } catch (error) { this.throwDuplicate(error); throw error; } }
  async update(id: string, input: UpdatePaymentMethod): Promise<PaymentMethod | null> { try { const row = await this.repository.preload({ id, ...(input.name === undefined ? {} : { name: input.name }), ...(input.order === undefined ? {} : { displayOrder: input.order }) }); return row ? this.map(await this.repository.save(row)) : null; } catch (error) { this.throwDuplicate(error); throw error; } }
  async updateStatus(id: string, isActive: boolean): Promise<PaymentMethod | null> { const row = await this.repository.preload({ id, isActive }); return row ? this.map(await this.repository.save(row)) : null; }
  private throwDuplicate(error: unknown): void { if (error instanceof QueryFailedError && (error as { driverError?: { code?: string } }).driverError?.code === '23505') throw new PaymentMethodNameAlreadyExistsError(); }
}
