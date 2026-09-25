import { describe, expect, it } from 'vitest';
import { canAccess } from './auth-permissions';
import type { AuthIdentity } from '../../domain/entities/auth';
const user: AuthIdentity = { id: '1', username: 'u', fullName: 'User', role: { id: 'r', code: 'STAFF', name: 'Staff', isSuperAdmin: false }, permissions: ['customers.view'] };
describe('canAccess', () => { it('accepts registered permission and rejects missing permission', () => { expect(canAccess(user, 'customers.view')).toBe(true); expect(canAccess(user, 'users.view')).toBe(false); }); it('bypasses permission checks for superadmins', () => { expect(canAccess({ ...user, role: { ...user.role, isSuperAdmin: true }, permissions: [] }, 'anything')).toBe(true); }); });
