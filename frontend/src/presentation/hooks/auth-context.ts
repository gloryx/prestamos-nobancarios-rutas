import { createContext, useContext } from 'react';
import type { AuthIdentity, LoginCredentials } from '../../domain/entities/auth';
export type AuthContextValue = { user?: AuthIdentity; loading: boolean; login(input: LoginCredentials): Promise<void>; logout(): Promise<void>; changePassword(current: string, next: string): Promise<void>; can(code: string): boolean };
export const AuthContext = createContext<AuthContextValue | undefined>(undefined);
export function useAuth(): AuthContextValue { const value = useContext(AuthContext); if (!value) throw new Error('useAuth debe usarse dentro de AuthProvider.'); return value; }
