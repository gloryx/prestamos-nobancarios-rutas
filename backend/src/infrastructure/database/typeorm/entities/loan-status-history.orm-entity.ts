import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { LoanStatusHistory } from '../../../../domain/loan/loan.types';

@Entity({ name: 'loan_status_history' })
export class LoanStatusHistoryOrmEntity implements LoanStatusHistory {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'loan_id', type: 'uuid' }) loanId!: string;
  @Column({ name: 'event_sequence', type: 'integer' }) eventSequence!: number;
  @Column({ name: 'event_kind', type: 'varchar' }) eventKind!: LoanStatusHistory['eventKind'];
  @Column({ name: 'from_status', type: 'varchar', nullable: true }) fromStatus!: LoanStatusHistory['fromStatus'];
  @Column({ name: 'to_status', type: 'varchar' }) toStatus!: LoanStatusHistory['toStatus'];
  @Column({ name: 'changed_at', type: 'timestamptz' }) changedAt!: Date;
  @Column({ name: 'changed_by_user_id', type: 'uuid', nullable: true }) changedByUserId!: string | null;
  @Column({ type: 'text', nullable: true }) reason!: string | null;
  @Column({ name: 'payment_id', type: 'uuid', nullable: true }) paymentId!: string | null;
  @Column({ name: 'payment_annulment_id', type: 'uuid', nullable: true }) paymentAnnulmentId!: string | null;
  @Column({ name: 'idempotency_key', type: 'varchar', length: 128, nullable: true }) idempotencyKey!: string | null;
  @Column({ name: 'idempotency_fingerprint', type: 'text', nullable: true }) idempotencyFingerprint!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
