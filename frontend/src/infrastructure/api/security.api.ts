import { apiClient } from './api-client';
import type { LoginCredentials, AuthIdentity } from '../../domain/entities/auth';
import type { SecurityRepository, UserQuery, UserRecord, RoleRecord, PermissionRecord } from '../../application/ports/security.repository';
export class SecurityApi implements SecurityRepository {
  login(input: LoginCredentials) { return apiClient.request<AuthIdentity>('/auth/login', { method: 'POST', body: JSON.stringify(input) }); }
  me() { return apiClient.request<AuthIdentity>('/auth/me'); }
  async logout() { await apiClient.request('/auth/logout', { method: 'POST' }); }
  async changePassword(currentPassword: string, newPassword: string) { await apiClient.request('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }); }
  listUsers(query: UserQuery) { const params = new URLSearchParams({ search: query.search, status: query.status, page: String(query.page), pageSize: String(query.pageSize) }); if (query.roleId) params.set('roleId', query.roleId); return apiClient.request<{ items: UserRecord[]; total: number; page: number; pageSize: number }>(`/users?${params}`); }
  createUser(input: { username: string; fullName: string; roleId: string; password: string }) { return apiClient.request<UserRecord>('/users', { method: 'POST', body: JSON.stringify(input) }); }
  updateUser(id: string, input: { username: string; fullName: string }) { return apiClient.request<UserRecord>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(input) }); }
  changeUserStatus(id: string, isActive: boolean) { return apiClient.request<UserRecord>(`/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) }); }
  assignUserRole(id: string, roleId: string) { return apiClient.request<UserRecord>(`/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ roleId }) }); }
  async resetUserPassword(id: string, password: string) { await apiClient.request(`/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) }); }
  listRoles() { return apiClient.request<RoleRecord[]>('/roles'); }
  rolePermissions(id: string) { return apiClient.request<{ role: RoleRecord; permissionCodes: string[] }>(`/roles/${id}/permissions`); }
  listPermissions() { return apiClient.request<PermissionRecord[]>('/permissions'); }
  updateRolePermissions(id: string, permissionCodes: string[]) { return apiClient.request<{ success: boolean; permissionCodes: string[] }>(`/roles/${id}/permissions`, { method: 'PUT', body: JSON.stringify({ permissionCodes }) }); }
}
