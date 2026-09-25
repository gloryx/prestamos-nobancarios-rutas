export type SecurityRole = { id: string; code: string; name: string; description?: string | null; isSystem?: boolean; isSuperAdmin: boolean; isActive: boolean; createdAt?: Date; updatedAt?: Date };
export type SecurityPermission = { id: string; code: string; name: string; module: string; description: string | null; createdAt?: Date; updatedAt?: Date };
export type SecurityUser = { id: string; username: string; fullName: string; passwordHash: string; roleId: string; role: SecurityRole; isActive: boolean; lastLoginAt: Date | null; createdAt: Date; updatedAt: Date };
export type SecuritySession = { id: string; userId: string; tokenHash: string; expiresAt: Date; revokedAt: Date | null; createdAt: Date };
export type CurrentIdentity = { id: string; username: string; fullName: string; role: Pick<SecurityRole, 'id' | 'code' | 'name' | 'isSuperAdmin'>; permissions: string[]; sessionId: string };
export type SafeUser = { id: string; username: string; fullName: string; role: { id: string; code?: string; name?: string; isSuperAdmin?: boolean }; isActive: boolean; lastLoginAt: Date | null; createdAt: Date; updatedAt: Date };
export type SafeProfile = { id: string; username: string; fullName: string; role: CurrentIdentity['role']; permissions: string[] };
