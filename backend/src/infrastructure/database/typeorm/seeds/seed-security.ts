import { EntityManager, In } from 'typeorm';
import * as argon2 from 'argon2';
import { PermissionOrmEntity, RoleOrmEntity, RolePermissionOrmEntity, UserOrmEntity } from '../entities';
import { COLLECTION_MANAGER_DEFAULTS, PERMISSIONS } from '../../../../shared/constants/security';

export async function seedSecurity(manager: EntityManager): Promise<void> {
  const permissionRepository = manager.getRepository(PermissionOrmEntity);
  for (const [code, name, module] of PERMISSIONS) await permissionRepository.upsert({ code, name, module, description: null }, ['code']);
  const roleRepository = manager.getRepository(RoleOrmEntity);
  const roles = [
    { code: 'ADMIN', name: 'ADMINISTRADOR', description: null, isSystem: true, isSuperAdmin: true, isActive: true },
    { code: 'COLLECTION_MANAGER', name: 'GESTOR DE COBROS', description: null, isSystem: true, isSuperAdmin: false, isActive: true },
    { code: 'COLLECTOR', name: 'COBRADOR', description: null, isSystem: true, isSuperAdmin: false, isActive: true },
  ];
  for (const role of roles) await roleRepository.upsert(role, ['code']);
  const managerRole = await roleRepository.findOneByOrFail({ code: 'COLLECTION_MANAGER' });
  const configured = await manager.getRepository(RolePermissionOrmEntity).count({ where: { roleId: managerRole.id } });
  if (configured === 0) { const defaults = await permissionRepository.findBy({ code: In([...COLLECTION_MANAGER_DEFAULTS]) }); await manager.getRepository(RolePermissionOrmEntity).insert(defaults.map((permission) => ({ roleId: managerRole.id, permissionId: permission.id }))); }
  const username = (process.env.BOOTSTRAP_ADMIN_USERNAME ?? 'admin').trim().toLowerCase();
  const existing = await manager.getRepository(UserOrmEntity).createQueryBuilder('u').where('lower(u.username) = :username', { username }).getOne();
  const admin = await roleRepository.findOneByOrFail({ code: 'ADMIN' });
  if (existing) { if (existing.roleId !== admin.id) throw new Error(`Bootstrap username "${username}" no pertenece al rol ADMIN.`); return; }
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? ''; if (!password) throw new Error('BOOTSTRAP_ADMIN_PASSWORD es obligatorio para crear el administrador inicial.');
  if (password.length < 12 || password.length > 128) throw new Error('BOOTSTRAP_ADMIN_PASSWORD debe tener entre 12 y 128 caracteres.');
  await manager.getRepository(UserOrmEntity).save({ username, fullName: 'ADMINISTRADOR PRESTAMOS NO BANCARIOS', passwordHash: await argon2.hash(password, { type: argon2.argon2id }), roleId: admin.id, isActive: true, lastLoginAt: null });
}
