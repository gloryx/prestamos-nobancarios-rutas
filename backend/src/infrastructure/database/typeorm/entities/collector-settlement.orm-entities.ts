import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { CollectorSettlementStatus } from '../../../../domain/collector-settlement/collector-settlement.types';

@Entity({ name: 'collector_settlements' })
@Check('CHK_collector_settlements_status', `"status" IN ('DRAFT','SUBMITTED','UNDER_REVIEW','CONFIRMED','REJECTED','CANCELLED')`)
@Index('UQ_collector_settlements_idempotency', ['idempotencyKey'], { unique: true })
export class CollectorSettlementOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'collector_id', type: 'uuid' }) collectorId!: string;
  @Column({ name: 'collector_user_id', type: 'uuid' }) collectorUserId!: string;
  @Column({ type: 'varchar', length: 20 }) status!: CollectorSettlementStatus;
  @Column({ name: 'total_declared', type: 'numeric', precision: 18, scale: 2 }) totalDeclared!: string;
  @Column({ name: 'total_confirmed', type: 'numeric', precision: 18, scale: 2, default: '0' }) totalConfirmed!: string;
  @Column({ name: 'amount_delivered', type: 'numeric', precision: 18, scale: 2, default: '0' }) amountDelivered!: string;
  @Column({ name: 'retained_amount', type: 'numeric', precision: 18, scale: 2, default: '0' }) retainedAmount!: string;
  @Column({ name: 'difference_amount', type: 'numeric', precision: 18, scale: 2, default: '0' }) differenceAmount!: string;
  @Column({ name: 'delivery_date', type: 'date', nullable: true }) deliveryDate!: string | null;
  @Column({ name: 'delivery_payment_method_id', type: 'uuid', nullable: true }) deliveryPaymentMethodId!: string | null;
  @Column({ name: 'delivery_reference', type: 'varchar', length: 200, nullable: true }) deliveryReference!: string | null;
  @Column({ name: 'delivery_notes', type: 'text', nullable: true }) deliveryNotes!: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) reason!: string | null;
  @Column({ name: 'created_by_user_id', type: 'uuid' }) createdByUserId!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'submitted_by_user_id', type: 'uuid', nullable: true }) submittedByUserId!: string | null;
  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true }) submittedAt!: Date | null;
  @Column({ name: 'reviewed_by_user_id', type: 'uuid', nullable: true }) reviewedByUserId!: string | null;
  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true }) reviewedAt!: Date | null;
  @Column({ name: 'confirmed_by_user_id', type: 'uuid', nullable: true }) confirmedByUserId!: string | null;
  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true }) confirmedAt!: Date | null;
  @Column({ name: 'rejected_by_user_id', type: 'uuid', nullable: true }) rejectedByUserId!: string | null;
  @Column({ name: 'rejected_at', type: 'timestamptz', nullable: true }) rejectedAt!: Date | null;
  @Column({ name: 'cancelled_by_user_id', type: 'uuid', nullable: true }) cancelledByUserId!: string | null;
  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true }) cancelledAt!: Date | null;
  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 }) idempotencyKey!: string;
  @Column({ name: 'idempotency_fingerprint', type: 'text' }) idempotencyFingerprint!: string;
  @Column({ name: 'last_action_idempotency_key', type: 'varchar', length: 128, nullable: true }) lastActionIdempotencyKey!: string | null;
  @Column({ name: 'last_action_fingerprint', type: 'text', nullable: true }) lastActionFingerprint!: string | null;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

@Entity({ name: 'collector_settlement_items' })
@Index('UQ_collector_settlement_items_pair', ['settlementId', 'precollectionId'], { unique: true })
export class CollectorSettlementItemOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'settlement_id', type: 'uuid' }) settlementId!: string;
  @Column({ name: 'precollection_id', type: 'uuid' }) precollectionId!: string;
  @Column({ name: 'declared_amount', type: 'numeric', precision: 18, scale: 2 }) declaredAmount!: string;
  @Column({ name: 'confirmed_amount', type: 'numeric', precision: 18, scale: 2, nullable: true }) confirmedAmount!: string | null;
  @Column({ name: 'payment_id', type: 'uuid', nullable: true }) paymentId!: string | null;
  @Column({ name: 'active_reservation', type: 'boolean', default: true }) activeReservation!: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

@Entity({ name: 'collector_settlement_actions' })
@Check('CHK_collector_settlement_actions_action', `"action" IN ('SUBMIT','REVIEW','REJECT','CANCEL','CONFIRM')`)
@Index('UQ_collector_settlement_actions_idempotency', ['idempotencyKey'], { unique: true })
export class CollectorSettlementActionOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'settlement_id', type: 'uuid' }) settlementId!: string;
  @Column({ type: 'varchar', length: 16 }) action!: 'SUBMIT' | 'REVIEW' | 'REJECT' | 'CANCEL' | 'CONFIRM';
  @Column({ name: 'actor_user_id', type: 'uuid' }) actorUserId!: string;
  @Column({ type: 'varchar', length: 500, nullable: true }) reason!: string | null;
  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 }) idempotencyKey!: string;
  @Column({ name: 'idempotency_fingerprint', type: 'text' }) idempotencyFingerprint!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
