import { BeforeInsert, BeforeUpdate, Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'payment_methods' })
export class PaymentMethodOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar', nullable: false }) name!: string;
  @Column({ name: 'display_order', type: 'integer', nullable: false }) displayOrder!: number;
  @Column({ name: 'is_active', type: 'boolean', default: true, nullable: false }) isActive!: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
  @BeforeInsert() @BeforeUpdate() trimName(): void { this.name = this.name.trim(); }
}
