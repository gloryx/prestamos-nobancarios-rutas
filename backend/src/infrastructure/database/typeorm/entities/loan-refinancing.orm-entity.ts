import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'loan_refinancings' })
@Index('UQ_refinancing_confirmed_origin', ['originLoanId'], { unique: true, where: `"status" = 'CONFIRMED'` })
export class LoanRefinancingOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'origin_loan_id', type: 'uuid' }) originLoanId!: string;
  @Column({ name: 'new_loan_id', type: 'uuid', unique: true }) newLoanId!: string;
  @Column({ name: 'outstanding_principal_transferred', type: 'numeric', precision: 18, scale: 2 }) outstandingPrincipalTransferred!: string;
  @Column({ name: 'capitalized_outstanding_interest', type: 'numeric', precision: 18, scale: 2 }) capitalizedOutstandingInterest!: string;
  @Column({ name: 'new_money_disbursed', type: 'numeric', precision: 18, scale: 2 }) newMoneyDisbursed!: string;
  @Column({ name: 'new_interest_amount', type: 'numeric', precision: 18, scale: 2 }) newInterestAmount!: string;
  @Column({ name: 'new_contractual_principal', type: 'numeric', precision: 18, scale: 2 }) newContractualPrincipal!: string;
  @Column({ name: 'new_contractual_total', type: 'numeric', precision: 18, scale: 2 }) newContractualTotal!: string;
  @Column({ name: 'refinancing_date', type: 'date' }) refinancingDate!: string;
  @Column({ type: 'varchar', length: 16, default: 'CONFIRMED' }) status!: 'CONFIRMED' | 'ANNULLED';
  @Column({ name: 'created_by_user_id', type: 'uuid' }) createdByUserId!: string;
  @Column({ name: 'idempotency_key', type: 'varchar', length: 128, unique: true }) idempotencyKey!: string;
  @Column({ name: 'idempotency_fingerprint', type: 'text' }) idempotencyFingerprint!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

@Entity({ name: 'loan_refinancing_annulments' })
export class LoanRefinancingAnnulmentOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'refinancing_id', type: 'uuid', unique: true }) refinancingId!: string;
  @Column({ name: 'annulment_type', type: 'varchar', length: 24 }) annulmentType!: 'DATA_CORRECTION' | 'CASH_REFUND';
  @Column({ name: 'effective_date', type: 'date' }) effectiveDate!: string;
  @Column({ type: 'varchar', length: 500 }) reason!: string;
  @Column({ name: 'annulled_at', type: 'timestamptz', default: () => 'now()' }) annulledAt!: Date;
  @Column({ name: 'created_by_user_id', type: 'uuid' }) createdByUserId!: string;
  @Column({ name: 'refund_payment_method_id', type: 'uuid', nullable: true }) refundPaymentMethodId!: string | null;
  @Column({ name: 'idempotency_key', type: 'varchar', length: 128, unique: true }) idempotencyKey!: string;
  @Column({ name: 'idempotency_fingerprint', type: 'text' }) idempotencyFingerprint!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
