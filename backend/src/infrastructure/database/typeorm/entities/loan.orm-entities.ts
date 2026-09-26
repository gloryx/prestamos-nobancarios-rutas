import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { CustomerOrmEntity } from './customer.orm-entity';
import { PaymentFrequencyOrmEntity } from './payment-frequency.orm-entity';
import { PaymentMethodOrmEntity } from './payment-method.orm-entity';
import { UserOrmEntity } from './user.orm-entity';

@Entity({ name: 'loans' })
export class LoanOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'loan_number', type: 'bigint' }) loanNumber!: string;
  @Column({ name: 'customer_id', type: 'uuid' }) customerId!: string;
  @ManyToOne(() => CustomerOrmEntity, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'customer_id' }) customer!: CustomerOrmEntity;
  @Column({ name: 'payment_frequency_id', type: 'uuid' }) paymentFrequencyId!: string;
  @ManyToOne(() => PaymentFrequencyOrmEntity, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'payment_frequency_id' }) paymentFrequency!: PaymentFrequencyOrmEntity;
  @Column({ name: 'preferred_payment_method_id', type: 'uuid' }) preferredPaymentMethodId!: string;
  @ManyToOne(() => PaymentMethodOrmEntity, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'preferred_payment_method_id' }) preferredPaymentMethod!: PaymentMethodOrmEntity;
  @Column({ name: 'start_date', type: 'date' }) startDate!: string;
  @Column({ type: 'numeric', precision: 18, scale: 2 }) principal!: string;
  @Column({ name: 'interest_amount', type: 'numeric', precision: 18, scale: 2 }) interestAmount!: string;
  @Column({ name: 'total_amount', type: 'numeric', precision: 18, scale: 2 }) totalAmount!: string;
  @Column({ type: 'text', nullable: true }) observations!: string | null;
  @Column({ type: 'varchar' }) status!: string;
  @Column({ name: 'created_by_user_id', type: 'uuid' }) createdByUserId!: string;
  @ManyToOne(() => UserOrmEntity, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'created_by_user_id' }) createdBy!: UserOrmEntity;
  @Column({ name: 'idempotency_key', type: 'varchar', length: 128, nullable: true }) idempotencyKey!: string | null;
  @Column({ name: 'idempotency_fingerprint', type: 'text', nullable: true }) idempotencyFingerprint!: string | null;
  @Column({ name: 'payment_plan_idempotency_key', type: 'varchar', length: 128, nullable: true }) paymentPlanIdempotencyKey!: string | null;
  @Column({ name: 'payment_plan_idempotency_fingerprint', type: 'text', nullable: true }) paymentPlanIdempotencyFingerprint!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

@Entity({ name: 'loan_disbursements' })
export class LoanDisbursementOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'loan_id', type: 'uuid', unique: true }) loanId!: string;
  @Column({ type: 'numeric', precision: 18, scale: 2 }) amount!: string;
  @Column({ name: 'payment_method_id', type: 'uuid' }) paymentMethodId!: string;
  @ManyToOne(() => PaymentMethodOrmEntity, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'payment_method_id' }) paymentMethod!: PaymentMethodOrmEntity;
  @Column({ name: 'disbursement_date', type: 'date' }) disbursementDate!: string;
  @Column({ name: 'created_by_user_id', type: 'uuid' }) createdByUserId!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

@Entity({ name: 'payment_plan_entries' })
export class PaymentPlanEntryOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'loan_id', type: 'uuid' }) loanId!: string;
  @Column({ type: 'integer' }) sequence!: number;
  @Column({ name: 'due_date', type: 'date' }) dueDate!: string;
  @Column({ name: 'pending_amount', type: 'numeric', precision: 18, scale: 2 }) pendingAmount!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
