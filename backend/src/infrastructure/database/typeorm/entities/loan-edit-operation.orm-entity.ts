import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'loan_edit_operations' })
export class LoanEditOperationOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'loan_id', type: 'uuid' }) loanId!: string;
  @Column({ name: 'created_by_user_id', type: 'uuid' }) createdByUserId!: string;
  @Column({ name: 'idempotency_key', type: 'varchar', length: 128, unique: true }) idempotencyKey!: string;
  @Column({ name: 'idempotency_fingerprint', type: 'varchar', length: 64 }) idempotencyFingerprint!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
