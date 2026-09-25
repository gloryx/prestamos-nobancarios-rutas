import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { UserOrmEntity } from './user.orm-entity';
@Entity({ name: 'collector_route_assignments' })
@Index('idx_collector_route_assignments_active_collector', ['collectorUserId'], { where: 'ended_at IS NULL' })
export class CollectorRouteAssignmentOrmEntity { @PrimaryGeneratedColumn('uuid') id!: string; @Column({ name: 'collector_user_id', type: 'uuid' }) collectorUserId!: string; @Column({ name: 'route_id', type: 'uuid' }) routeId!: string; @Column({ name: 'assigned_by_user_id', type: 'uuid' }) assignedByUserId!: string; @ManyToOne(() => UserOrmEntity, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'assigned_by_user_id' }) assignedByUser!: UserOrmEntity; @CreateDateColumn({ name: 'assigned_at', type: 'timestamptz' }) assignedAt!: Date; @Column({ name: 'ended_at', type: 'timestamptz', nullable: true }) endedAt!: Date | null; }
