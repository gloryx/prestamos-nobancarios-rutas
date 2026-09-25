import { BeforeInsert, BeforeUpdate, Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { IntervalUnit } from '../../../../domain/payment-frequency/payment-frequency.types';

@Entity({ name: 'payment_frequencies' })
export class PaymentFrequencyOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar', nullable: false }) name!: string;
  @Column({ name: 'interval_unit', type: 'varchar', enum: ['DAY', 'WEEK', 'MONTH'], nullable: false }) intervalUnit!: IntervalUnit;
  @Column({ name: 'interval_value', type: 'integer', nullable: false }) intervalValue!: number;
  @Column({ name: 'display_order', type: 'integer', nullable: false }) displayOrder!: number;
  @Column({ name: 'is_active', type: 'boolean', default: true, nullable: false }) isActive!: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
  @BeforeInsert() @BeforeUpdate() trimName(): void { this.name = this.name.trim(); }
}
