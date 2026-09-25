import { BeforeInsert, BeforeUpdate, Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'routes' })
export class RouteOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar', nullable: false }) name!: string;
  @Column({ name: 'is_active', type: 'boolean', default: true, nullable: false }) isActive!: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', nullable: false }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz', nullable: false }) updatedAt!: Date;
  @BeforeInsert() @BeforeUpdate() trimName(): void { this.name = this.name.trim(); }
}
