import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import { installStaffKeepalive, uninstallStaffKeepalive } from './sessionKeepalive';

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
  /** Resolves once the server session is gone (await before navigating away,
   *  or an unload can cancel the POST and leave the cookie alive). */
  logout: () => Promise<void>;
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
      .then((res) => { setUser(res.data); setTokenState(true); installStaffKeepalive(); })
      .catch(() => { setUser(null); setTokenState(false); })
      .finally(() => setReady(true));
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<User> => {
    const res = await api.post<{ data: { user: User } }>('/api/auth/login', { email, password });
    const { user } = res.data;
    setTokenState(true);
    setReady(true);
    setUser(user);
    installStaffKeepalive();
    return user;
  }, []);

  const logout = useCallback(() => {
    setTokenState(false);
    setReady(true);
    setUser(null);
    // Symmetry with the portal fix: stop renewing a dead session, or the
    // keepalive's next 401 hard-reloads the login form out from under the
    // user.
    uninstallStaffKeepalive();
    // Returned, not fire-and-forget: a caller that navigates/redirects right
    // after logout would otherwise cancel the request mid-flight at unload.
    return api.post('/api/auth/logout').then(() => undefined).catch(() => undefined);
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