import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { RoleOrmEntity } from './role.orm-entity';
import { UserSessionOrmEntity } from './user-session.orm-entity';

@Entity({ name: 'users' })
export class UserOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ unique: true }) username!: string;
  @Column({ name: 'full_name' }) fullName!: string;
  @Column({ name: 'password_hash', select: false }) passwordHash!: string;
  @Column({ name: 'role_id', type: 'uuid' }) roleId!: string;
  @ManyToOne(() => RoleOrmEntity, (role) => role.users, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'role_id' }) role!: RoleOrmEntity;
  @Column({ name: 'is_active', default: true }) isActive!: boolean;
  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true }) lastLoginAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
  @OneToMany(() => UserSessionOrmEntity, (session) => session.user) sessions!: UserSessionOrmEntity[];
}
