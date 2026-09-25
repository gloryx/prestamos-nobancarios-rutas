import { SecurityPermission, SecurityRole, SecuritySession, SecurityUser } from '../../domain/security/security.types';
export const SECURITY_REPOSITORY = Symbol('SECURITY_REPOSITORY');
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
export const SECURE_TOKEN_GENERATOR = Symbol('SECURE_TOKEN_GENERATOR');
export interface SecurityRepository {
  findUserByUsername(username: string): Promise<SecurityUser | null>; findUserById(id: string): Promise<SecurityUser | null>; listUsers(filter: { search?: string; status?: string; roleId?: string; page: number; pageSize: number }): Promise<{ items: SecurityUser[]; total: number }>;
  usernameExists(username: string, exceptId?: string): Promise<boolean>; saveUser(user: Partial<SecurityUser> & { id?: string }): Promise<SecurityUser>; findActiveRole(id: string): Promise<SecurityRole | null>; listRoles(): Promise<SecurityRole[]>; listPermissions(): Promise<SecurityPermission[]>; rolePermissionCodes(roleId: string): Promise<string[]>; replaceRolePermissions(roleId: string, permissionIds: string[]): Promise<void>; findPermissionsByCodes(codes: string[]): Promise<SecurityPermission[]>;
  findSessionByHash(tokenHash: string): Promise<SecuritySession | null>; saveSession(session: Omit<SecuritySession, 'id' | 'createdAt'>): Promise<SecuritySession>; revokeSession(id: string): Promise<void>; revokeOtherSessions(userId: string, exceptSessionId: string): Promise<void>; revokeUserSessions(userId: string): Promise<void>; countActiveSuperAdmins(): Promise<number>;
}
export interface PasswordHasher { hash(value: string): Promise<string>; verify(hash: string, value: string): Promise<boolean>; }
export interface SecureTokenGenerator { generate(): { raw: string; hash: string }; hash(raw: string): string; }
