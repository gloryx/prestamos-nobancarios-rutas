import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { RolePermissionOrmEntity } from './role-permission.orm-entity';

@Entity({ name: 'permissions' })
export class PermissionOrmEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ unique: true }) code!: string;
  @Column() name!: string;
  @Column() module!: string;
  @Column({ type: 'varchar', nullable: true }) description!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
  @OneToMany(() => RolePermissionOrmEntity, (entry) => entry.permission) rolePermissions!: RolePermissionOrmEntity[];
}
