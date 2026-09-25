import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { UserOrmEntity } from './user.orm-entity';

@Entity({ name: 'financial_openings' })
export class FinancialOpeningOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'opening_date', type: 'date' }) openingDate!: string;
  @Column({ name: 'initial_available_amount', type: 'numeric', precision: 18, scale: 2 }) initialAvailableAmount!: string;
  @Column({ name: 'initial_portfolio', type: 'numeric', precision: 18, scale: 2 }) initialPortfolio!: string;
  @Column({ name: 'initial_uncollectible_amount', type: 'numeric', precision: 18, scale: 2 }) initialUncollectibleAmount!: string;
  @Column({ name: 'historical_seed_capital', type: 'numeric', precision: 18, scale: 2 }) historicalSeedCapital!: string;
  @Column({ type: 'text', nullable: true }) observations!: string | null;
  @Column({ name: 'opened_by_user_id', type: 'uuid' }) openedByUserId!: string;
  @ManyToOne(() => UserOrmEntity, { nullable: false, onDelete: 'RESTRICT', eager: false }) @JoinColumn({ name: 'opened_by_user_id' }) openedBy!: UserOrmEntity;
  @Column({ name: 'opened_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' }) openedAt!: Date;
  @Column({ name: 'singleton_key', type: 'varchar', length: 20, default: 'DEFAULT' }) singletonKey!: string;
}
