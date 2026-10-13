import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { CollectorCustodyTreatment, CollectorPrecollectionStatus } from '../../../../domain/collector-precollection/collector-precollection.types';

@Entity({ name: 'collector_precollections' })
@Check('CHK_collector_precollections_status', `"status" IN ('RECORDED','SUBMITTED','SETTLED','REJECTED','CANCELLED')`)
@Check('CHK_collector_precollections_amount', '"amount" > 0')
@Check('CHK_collector_precollections_cancellation_shape', `("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL AND "cancelled_by_user_id" IS NOT NULL AND "cancellation_reason" IS NOT NULL AND "cancellation_idempotency_key" IS NOT NULL AND "cancellation_idempotency_fingerprint" IS NOT NULL) OR ("status" <> 'CANCELLED' AND "cancelled_at" IS NULL AND "cancelled_by_user_id" IS NULL AND "cancellation_reason" IS NULL AND "cancellation_idempotency_key" IS NULL AND "cancellation_idempotency_fingerprint" IS NULL)`)
@Index('UQ_collector_precollections_idempotency', ['idempotencyKey'], { unique: true })
@Index('UQ_collector_precollections_cancellation_key', ['cancellationIdempotencyKey'], { unique: true, where: 'cancellation_idempotency_key IS NOT NULL' })
@Index('IDX_collector_precollections_collector_date', ['collectorId', 'effectiveDate', 'recordedAt'])
@Index('IDX_collector_precollections_loan_reservation', ['loanId', 'status'])
export class CollectorPrecollectionOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'collector_id', type: 'uuid' }) collectorId!: string;
  @Column({ name: 'collector_user_id', type: 'uuid' }) collectorUserId!: string;
  @Column({ name: 'customer_id', type: 'uuid' }) customerId!: string;
  @Column({ name: 'loan_id', type: 'uuid' }) loanId!: string;
  @Column({ name: 'route_id', type: 'uuid' }) routeId!: string;
  @Column({ name: 'customer_route_assignment_id', type: 'uuid' }) customerRouteAssignmentId!: string;
  @Column({ name: 'collector_route_assignment_id', type: 'uuid' }) collectorRouteAssignmentId!: string;
  @Column({ name: 'payment_method_id', type: 'uuid' }) paymentMethodId!: string;
  @Column({ name: 'custody_treatment', type: 'varchar', length: 24 }) custodyTreatment!: CollectorCustodyTreatment;
  @Column({ type: 'numeric', precision: 18, scale: 2 }) amount!: string;
  @Column({ name: 'effective_date', type: 'date' }) effectiveDate!: string;
  @Column({ type: 'varchar', length: 200, nullable: true }) reference!: string | null;
  @Column({ type: 'text', nullable: true }) notes!: string | null;
  @Column({ type: 'varchar', length: 16 }) status!: CollectorPrecollectionStatus;
  @Column({ name: 'recorded_by_user_id', type: 'uuid' }) recordedByUserId!: string;
  @CreateDateColumn({ name: 'recorded_at', type: 'timestamptz' }) recordedAt!: Date;
  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 }) idempotencyKey!: string;
  @Column({ name: 'idempotency_fingerprint', type: 'text' }) idempotencyFingerprint!: string;
  @Column({ name: 'cancelled_by_user_id', type: 'uuid', nullable: true }) cancelledByUserId!: string | null;
  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true }) cancelledAt!: Date | null;
  @Column({ name: 'cancellation_reason', type: 'varchar', length: 500, nullable: true }) cancellationReason!: string | null;
  @Column({ name: 'cancellation_idempotency_key', type: 'varchar', length: 128, nullable: true }) cancellationIdempotencyKey!: string | null;
  @Column({ name: 'cancellation_idempotency_fingerprint', type: 'text', nullable: true }) cancellationIdempotencyFingerprint!: string | null;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
