import type { AuthIdentity } from '../../domain/entities/auth';

export function canAccess(user: AuthIdentity | undefined, code: string): boolean {
  return Boolean(user?.role.isSuperAdmin || user?.permissions.includes(code));
}

export function canAccessAll(user: AuthIdentity | undefined, codes: string[]): boolean {
  return codes.every((code) => canAccess(user, code));
}
