import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { UserOrmEntity } from './user.orm-entity';

@Entity({ name: 'financial_closes' })
export class FinancialCloseOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar', length: 7, unique: true }) period!: string;
  @Column({ type: 'integer', unique: true }) sequence!: number;
  @Column({ name: 'model_version', type: 'integer' }) modelVersion!: number;
  @Column({ name: 'from_date', type: 'date' }) fromDate!: string;
  @Column({ name: 'to_date', type: 'date' }) toDate!: string;
  @Column({ name: 'integrity_status', type: 'varchar', length: 20 }) integrityStatus!: string;
  @Column({ name: 'blocking_issues', type: 'jsonb', default: () => "'[]'::jsonb" }) blockingIssues!: string[];
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" }) warnings!: string[];
  @Column({ name: 'confirmed_by_user_id', type: 'uuid' }) confirmedByUserId!: string;
  @ManyToOne(() => UserOrmEntity, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'confirmed_by_user_id' }) confirmedBy!: UserOrmEntity;
  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true }) confirmedAt!: Date | null;
  @OneToMany(() => FinancialCloseConceptOrmEntity, (concept) => concept.close) concepts!: FinancialCloseConceptOrmEntity[];
}

@Entity({ name: 'financial_close_concepts' })
export class FinancialCloseConceptOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'financial_close_id', type: 'uuid' }) financialCloseId!: string;
  @ManyToOne(() => FinancialCloseOrmEntity, (close) => close.concepts, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'financial_close_id' }) close!: FinancialCloseOrmEntity;
  @Column({ type: 'varchar', length: 40 }) section!: string;
  @Column({ type: 'varchar', length: 80 }) code!: string;
  @Column({ type: 'varchar', length: 160 }) label!: string;
  @Column({ type: 'varchar', length: 40 }) classification!: string;
  @Column({ type: 'numeric', precision: 38, scale: 2 }) amount!: string;
  @Column({ type: 'integer' }) ordinal!: number;
}
