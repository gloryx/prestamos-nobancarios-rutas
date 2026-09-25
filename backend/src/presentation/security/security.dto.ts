import { IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
export class LoginDto { @IsString() username!: string; @IsString() password!: string; }
export class ChangePasswordDto { @IsString() currentPassword!: string; @IsString() newPassword!: string; }
export class CreateUserDto { @IsString() @MaxLength(100) username!: string; @IsString() @MaxLength(200) fullName!: string; @IsUUID() roleId!: string; @IsString() password!: string; }
export class UpdateUserDto { @IsOptional() @IsString() @MaxLength(100) username?: string; @IsOptional() @IsString() @MaxLength(200) fullName?: string; }
export class UserStatusDto { @IsBoolean() isActive!: boolean; }
export class AssignRoleDto { @IsUUID() roleId!: string; }
export class ResetPasswordDto { @IsString() password!: string; }
export class RolePermissionsDto { @IsArray() @IsString({ each: true }) permissionCodes!: string[]; }
export class UserQueryDto { @IsOptional() @IsString() search?: string; @IsOptional() @IsIn(['ACTIVE', 'INACTIVE', 'ALL']) status?: 'ACTIVE'|'INACTIVE'|'ALL'; @IsOptional() @IsUUID() roleId?: string; @IsOptional() page?: number; @IsOptional() pageSize?: number; }
