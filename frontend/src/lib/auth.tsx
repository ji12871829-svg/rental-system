import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';

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
  token: boolean;
  ready: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => void;
  isAdmin: boolean;
  isManager: boolean;
  canManage: boolean; // ADMIN or PROPERTY_MANAGER
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState(false);
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    api.get<{ data: User }>('/api/auth/me')
      .then((res) => { setUser(res.data); setTokenState(true); })
      .catch(() => { setUser(null); setTokenState(false); })
      .finally(() => setReady(true));
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<User> => {
    const res = await api.post<{ data: { user: User } }>('/api/auth/login', { email, password });
    const { user } = res.data;
    setTokenState(true);
    setReady(true);
    setUser(user);
    return user;
  }, []);

  const logout = useCallback(() => {
    void api.post('/api/auth/logout').catch(() => undefined);
    setTokenState(false);
    setReady(true);
    setUser(null);
  }, []);

  const value = useMemo<AuthState>(() => ({
    user,
    token,
    ready,
    login,
    logout,
    isAdmin: user?.role === 'ADMIN',
    isManager: user?.role === 'ADMIN' || user?.role === 'PROPERTY_MANAGER',
    canManage: user?.role === 'ADMIN' || user?.role === 'PROPERTY_MANAGER',
  }), [user, token, ready, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}