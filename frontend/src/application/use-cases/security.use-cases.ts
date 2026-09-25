import type { LoginCredentials } from '../../domain/entities/auth';
import type { SecurityRepository, UserQuery } from '../ports/security.repository';
export const securityUseCases = (repository: SecurityRepository) => ({
  login: { execute: (input: LoginCredentials) => repository.login(input) }, me: { execute: () => repository.me() }, logout: { execute: () => repository.logout() },
  users: { list: (query: UserQuery) => repository.listUsers(query), create: repository.createUser.bind(repository), update: repository.updateUser.bind(repository), status: repository.changeUserStatus.bind(repository), role: repository.assignUserRole.bind(repository), reset: repository.resetUserPassword.bind(repository) },
  roles: { list: () => repository.listRoles(), permissions: (id: string) => repository.rolePermissions(id), allPermissions: () => repository.listPermissions(), save: repository.updateRolePermissions.bind(repository) },
});
