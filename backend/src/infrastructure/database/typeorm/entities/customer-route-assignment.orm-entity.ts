import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { UserOrmEntity } from './user.orm-entity';
@Entity({ name: 'customer_route_assignments' })
@Index('idx_customer_route_assignments_active_customer', ['customerId'], { where: 'ended_at IS NULL' })
export class CustomerRouteAssignmentOrmEntity { @PrimaryGeneratedColumn('uuid') id!: string; @Column({ name: 'customer_id', type: 'uuid' }) customerId!: string; @Column({ name: 'route_id', type: 'uuid' }) routeId!: string; @Column({ name: 'assigned_by_user_id', type: 'uuid' }) assignedByUserId!: string; @ManyToOne(() => UserOrmEntity, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'assigned_by_user_id' }) assignedByUser!: UserOrmEntity; @CreateDateColumn({ name: 'assigned_at', type: 'timestamptz' }) assignedAt!: Date; @Column({ name: 'ended_at', type: 'timestamptz', nullable: true }) endedAt!: Date | null; }
