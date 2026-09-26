import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'payments' })
export class PaymentOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'loan_id', type: 'uuid' }) loanId!: string;
  @Column({ type: 'numeric', precision: 18, scale: 2 }) amount!: string;
  @Column({ name: 'principal_applied', type: 'numeric', precision: 18, scale: 2 }) principalApplied!: string;
  @Column({ name: 'interest_applied', type: 'numeric', precision: 18, scale: 2 }) interestApplied!: string;
  @Column({ name: 'payment_date', type: 'date' }) paymentDate!: string;
  @Column({ name: 'method_id', type: 'uuid' }) methodId!: string;
  @Column({ name: 'collector_id', type: 'uuid', nullable: true }) collectorId!: string | null;
  @Column({ name: 'created_by_user_id', type: 'uuid' }) createdByUserId!: string;
  @Column({ type: 'varchar' }) status!: 'VALID' | 'ANNULLED';
  @Column({ name: 'idempotency_key', type: 'varchar', length: 128, nullable: true }) idempotencyKey!: string | null;
  @Column({ name: 'idempotency_fingerprint', type: 'text', nullable: true }) idempotencyFingerprint!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

@Entity({ name: 'payment_applications' })
export class PaymentApplicationOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'payment_id', type: 'uuid' }) paymentId!: string;
  @Column({ name: 'payment_plan_entry_id', type: 'uuid' }) paymentPlanEntryId!: string;
  @Column({ name: 'amount_applied', type: 'numeric', precision: 18, scale: 2 }) amountApplied!: string;
  @Column({ name: 'pending_before', type: 'numeric', precision: 18, scale: 2 }) pendingBefore!: string;
  @Column({ name: 'pending_after', type: 'numeric', precision: 18, scale: 2 }) pendingAfter!: string;
  @Column({ name: 'carried_forward_amount', type: 'numeric', precision: 18, scale: 2, default: '0.00' }) carriedForwardAmount!: string;
  @Column({ name: 'carried_to_plan_entry_id', type: 'uuid', nullable: true }) carriedToPlanEntryId!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

@Entity({ name: 'payment_annulments' })
export class PaymentAnnulmentOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'payment_id', type: 'uuid', unique: true }) paymentId!: string;
  @Column({ type: 'text' }) reason!: string;
  @Column({ name: 'annulled_at', type: 'timestamptz' }) annulledAt!: Date;
  @Column({ name: 'created_by_user_id', type: 'uuid' }) createdByUserId!: string;
  @Column({ name: 'idempotency_key', type: 'varchar', length: 128, unique: true }) idempotencyKey!: string;
  @Column({ name: 'idempotency_fingerprint', type: 'text' }) idempotencyFingerprint!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
