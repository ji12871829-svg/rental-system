// Auth context for the tenant portal — a separate session from the staff
// app (different cookie + endpoint), so both can coexist in one browser.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { portalApi } from './portalApi';

export interface PortalTenant {
  tenantId: number;
  name: string;
  email: string;
}

interface PortalAuthContextValue {
  tenant: PortalTenant | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const PortalAuthContext = createContext<PortalAuthContextValue | undefined>(undefined);

export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const [tenant, setTenant] = useState<PortalTenant | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    portalApi
      .get<{ data: PortalTenant }>('/api/portal/me')
      .then((res) => {
        if (!cancelled) setTenant(res.data);
      })
      .catch(() => {
        // Not signed in — the login page will handle it.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await portalApi.post<{ data: PortalTenant }>('/api/portal/login', {
      email: email.trim().toLowerCase(),
      password,
    });
    setTenant(res.data);
  }, []);

  const logout = useCallback(async () => {
    try {
      await portalApi.post('/api/portal/logout');
    } finally {
      setTenant(null);
    }
  }, []);

  const value = useMemo(
    () => ({ tenant, loading, login, logout }),
    [tenant, loading, login, logout],
  );

  return <PortalAuthContext.Provider value={value}>{children}</PortalAuthContext.Provider>;
}

export function usePortalAuth(): PortalAuthContextValue {
  const ctx = useContext(PortalAuthContext);
  if (!ctx) throw new Error('usePortalAuth must be used within PortalAuthProvider');
  return ctx;
}
