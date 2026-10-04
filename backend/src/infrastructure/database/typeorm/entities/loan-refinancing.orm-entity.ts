import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'loan_refinancings' })
export class LoanRefinancingOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'origin_loan_id', type: 'uuid', unique: true }) originLoanId!: string;
  @Column({ name: 'new_loan_id', type: 'uuid', unique: true }) newLoanId!: string;
  @Column({ name: 'outstanding_principal_transferred', type: 'numeric', precision: 18, scale: 2 }) outstandingPrincipalTransferred!: string;
  @Column({ name: 'capitalized_outstanding_interest', type: 'numeric', precision: 18, scale: 2 }) capitalizedOutstandingInterest!: string;
  @Column({ name: 'new_money_disbursed', type: 'numeric', precision: 18, scale: 2 }) newMoneyDisbursed!: string;
  @Column({ name: 'new_interest_amount', type: 'numeric', precision: 18, scale: 2 }) newInterestAmount!: string;
  @Column({ name: 'new_contractual_principal', type: 'numeric', precision: 18, scale: 2 }) newContractualPrincipal!: string;
  @Column({ name: 'new_contractual_total', type: 'numeric', precision: 18, scale: 2 }) newContractualTotal!: string;
  @Column({ name: 'refinancing_date', type: 'date' }) refinancingDate!: string;
  @Column({ name: 'created_by_user_id', type: 'uuid' }) createdByUserId!: string;
  @Column({ name: 'idempotency_key', type: 'varchar', length: 128, unique: true }) idempotencyKey!: string;
  @Column({ name: 'idempotency_fingerprint', type: 'text' }) idempotencyFingerprint!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
