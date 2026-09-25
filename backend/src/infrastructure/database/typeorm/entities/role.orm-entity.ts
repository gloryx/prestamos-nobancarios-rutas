import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { UserOrmEntity } from './user.orm-entity';
import { RolePermissionOrmEntity } from './role-permission.orm-entity';

@Entity({ name: 'roles' })
export class RoleOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ unique: true }) code!: string;
  @Column() name!: string;
  @Column({ type: 'varchar', nullable: true }) description!: string | null;
  @Column({ name: 'is_system', default: false }) isSystem!: boolean;
  @Column({ name: 'is_super_admin', default: false }) isSuperAdmin!: boolean;
  @Column({ name: 'is_active', default: true }) isActive!: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
  @OneToMany(() => UserOrmEntity, (user) => user.role) users!: UserOrmEntity[];
  @OneToMany(() => RolePermissionOrmEntity, (entry) => entry.role) rolePermissions!: RolePermissionOrmEntity[];
}
