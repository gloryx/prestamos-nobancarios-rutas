import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { PaymentMethodOrmEntity } from './payment-method.orm-entity';
import { UserOrmEntity } from './user.orm-entity';
@Entity({ name: 'cash_movements' })
export class CashMovementOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar' }) direction!: string;
  @Column({ type: 'varchar' }) concept!: string;
  @Column({ type: 'numeric', precision: 18, scale: 2 }) amount!: string;
  @Column({ name: 'movement_date', type: 'date' }) movementDate!: string;
  @Column({ name: 'payment_method_id', type: 'uuid' }) paymentMethodId!: string;
  @ManyToOne(() => PaymentMethodOrmEntity, { onDelete: 'RESTRICT', eager: false }) @JoinColumn({ name: 'payment_method_id' }) paymentMethod!: PaymentMethodOrmEntity;
  @Column({ type: 'text', nullable: true }) observations!: string | null;
  @Column({ name: 'reversed_movement_id', type: 'uuid', nullable: true }) reversedMovementId!: string | null;
  @ManyToOne(() => CashMovementOrmEntity, { onDelete: 'RESTRICT', nullable: true, eager: false }) @JoinColumn({ name: 'reversed_movement_id' }) reversedMovement!: CashMovementOrmEntity | null;
  @Column({ name: 'created_by_user_id', type: 'uuid' }) createdByUserId!: string;
  @ManyToOne(() => UserOrmEntity, { onDelete: 'RESTRICT', eager: false }) @JoinColumn({ name: 'created_by_user_id' }) createdBy!: UserOrmEntity;
  @Column({ name: 'idempotency_key', type: 'varchar', length: 128, nullable: true }) idempotencyKey!: string | null;
  @Column({ name: 'idempotency_fingerprint', type: 'text', nullable: true }) idempotencyFingerprint!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
