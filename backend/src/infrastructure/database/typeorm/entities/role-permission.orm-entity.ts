import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { RoleOrmEntity } from './role.orm-entity';
import { PermissionOrmEntity } from './permission.orm-entity';

@Entity({ name: 'role_permissions' })
export class RolePermissionOrmEntity {
  @PrimaryColumn({ name: 'role_id', type: 'uuid' }) roleId!: string;
  @PrimaryColumn({ name: 'permission_id', type: 'uuid' }) permissionId!: string;
  @ManyToOne(() => RoleOrmEntity, (role) => role.rolePermissions, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'role_id' }) role!: RoleOrmEntity;
  @ManyToOne(() => PermissionOrmEntity, (permission) => permission.rolePermissions, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'permission_id' }) permission!: PermissionOrmEntity;
}
