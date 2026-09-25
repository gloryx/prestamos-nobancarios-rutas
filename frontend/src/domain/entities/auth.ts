export type AuthRole = { id: string; code: string; name: string; isSuperAdmin: boolean };
export type AuthIdentity = { id: string; username: string; fullName: string; role: AuthRole; permissions: string[] };
export type LoginCredentials = { username: string; password: string };
export type AuthRepository = { login(input: LoginCredentials): Promise<AuthIdentity>; me(): Promise<AuthIdentity>; logout(): Promise<void>; changePassword(currentPassword: string, newPassword: string): Promise<void> };
