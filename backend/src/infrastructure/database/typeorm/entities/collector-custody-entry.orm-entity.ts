import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { CollectorCustodyDirection, CollectorCustodyEntryType } from '../../../../domain/collector-custody/collector-custody.types';

@Entity({ name: 'collector_custody_entries' })
@Check('CHK_collector_custody_entries_amount', '"amount" > 0')
@Check('CHK_collector_custody_entries_direction', `"direction" IN ('CREDIT','DEBIT')`)
@Check('CHK_collector_custody_entries_type', `"entry_type" IN ('CUSTOMER_COLLECTION','REMITTANCE_TO_COMPANY','COMPANY_TOP_UP','AUTHORIZED_ADJUSTMENT','REVERSAL','LOAN_DISBURSEMENT')`)
@Index('UQ_collector_custody_entries_idempotency', ['idempotencyKey'], { unique: true })
export class CollectorCustodyEntryOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'collector_id', type: 'uuid' }) collectorId!: string;
  @Column({ type: 'varchar', length: 6 }) direction!: CollectorCustodyDirection;
  @Column({ name: 'entry_type', type: 'varchar', length: 32 }) entryType!: CollectorCustodyEntryType;
  @Column({ type: 'numeric', precision: 18, scale: 2 }) amount!: string;
  @Column({ name: 'effective_date', type: 'date' }) effectiveDate!: string;
  @Column({ name: 'payment_method_id', type: 'uuid', nullable: true }) paymentMethodId!: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) reference!: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) reason!: string | null;
  @Column({ type: 'text', nullable: true }) notes!: string | null;
  @Column({ name: 'precollection_id', type: 'uuid', nullable: true }) precollectionId!: string | null;
  @Column({ name: 'settlement_id', type: 'uuid', nullable: true }) settlementId!: string | null;
  @Column({ name: 'reversed_entry_id', type: 'uuid', nullable: true }) reversedEntryId!: string | null;
  @Column({ name: 'created_by_user_id', type: 'uuid' }) createdByUserId!: string;
  @Column({ name: 'idempotency_key', type: 'varchar', length: 160 }) idempotencyKey!: string;
  @Column({ name: 'idempotency_fingerprint', type: 'text' }) idempotencyFingerprint!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
