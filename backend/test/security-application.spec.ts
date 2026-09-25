import { SecurityService } from '../src/application/security/security.service';
import { SecurityRepository, PasswordHasher, SecureTokenGenerator } from '../src/application/security/security.ports';
import { SecurityUser } from '../src/domain/security/security.types';

const user = (): SecurityUser => ({ id: 'u1', username: 'admin', fullName: 'ADMIN', passwordHash: 'hash', roleId: 'r1', role: { id: 'r1', code: 'ADMIN', name: 'Administrador', isSuperAdmin: true, isActive: true }, isActive: true, lastLoginAt: null, createdAt: new Date(), updatedAt: new Date() });
const repository = (permissions: string[]): SecurityRepository => ({
  findUserByUsername: jest.fn(async () => user()), findUserById: jest.fn(async () => user()), rolePermissionCodes: jest.fn(async () => permissions), saveSession: jest.fn(async (value) => ({ ...value, id: 's1', createdAt: new Date() })), saveUser: jest.fn(async (value) => ({ ...user(), ...value })), findSessionByHash: jest.fn(async () => ({ id: 's1', userId: 'u1', tokenHash: 'hashed-token', expiresAt: new Date(Date.now() + 10000), revokedAt: null, createdAt: new Date() })),
  listUsers: jest.fn(), usernameExists: jest.fn(async () => false), findActiveRole: jest.fn(), listRoles: jest.fn(), listPermissions: jest.fn(), findPermissionsByCodes: jest.fn(), replaceRolePermissions: jest.fn(), revokeSession: jest.fn(), revokeOtherSessions: jest.fn(), revokeUserSessions: jest.fn(), countActiveSuperAdmins: jest.fn(),
});
const hasher: PasswordHasher = { hash: jest.fn(async (value) => `hashed-${value}`), verify: jest.fn(async () => true) };
const tokens: SecureTokenGenerator = { generate: () => ({ raw: 'raw-token', hash: 'hashed-token' }), hash: () => 'hashed-token' };

describe('security application boundary', () => {
  it('creates a session through ports without exposing persistence details', async () => {
    const repo = repository([]); const service = new SecurityService(repo, hasher, tokens, 12);
    const result = await service.login(' Admin ', 'password');
    expect(result.token).toBe('raw-token');
    expect(repo.saveSession).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', tokenHash: 'hashed-token' }));
    expect(result.identity).not.toHaveProperty('passwordHash');
  });

  it('loads role permissions afresh for each authenticated request', async () => {
    const permissions = ['customers.view']; const repo = repository(permissions); const service = new SecurityService(repo, hasher, tokens, 12);
    expect((await service.authenticate('raw-token')).permissions).toEqual(['customers.view']);
    permissions.splice(0, 1, 'customers.update');
    expect((await service.authenticate('raw-token')).permissions).toEqual(['customers.update']);
    expect(repo.rolePermissionCodes).toHaveBeenCalledTimes(2);
  });
});
