import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { api, getToken, setToken } from './api';

type Role = 'ADMIN' | 'PROPERTY_MANAGER' | 'STAFF';

export interface User {
  id: number;
  name: string;
  email: string;
  phone?: string | null;
  role: Role;
}

interface AuthState {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<User>;
  logout: () => void;
  isAdmin: boolean;
  isManager: boolean;
  canManage: boolean; // ADMIN or PROPERTY_MANAGER
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [user, setUser] = useState<User | null>(() => {
    try {
      const raw = localStorage.getItem('rpms_user');
      return raw ? (JSON.parse(raw) as User) : null;
    } catch {
      return null;
    }
  });

  const login = useCallback(async (email: string, password: string): Promise<User> => {
    // The API wraps every payload in { data }: { data: { token, user } }.
    const res = await api.post<{ data: { token: string; user: User } }>('/api/auth/login', { email, password });
    const { token, user } = res.data;
    setToken(token);
    localStorage.setItem('rpms_user', JSON.stringify(user));
    setTokenState(token);
    setUser(user);
    return user;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    localStorage.removeItem('rpms_user');
    setTokenState(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthState>(() => ({
    user,
    token,
    login,
    logout,
    isAdmin: user?.role === 'ADMIN',
    isManager: user?.role === 'ADMIN' || user?.role === 'PROPERTY_MANAGER',
    canManage: user?.role === 'ADMIN' || user?.role === 'PROPERTY_MANAGER',
  }), [user, token, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}