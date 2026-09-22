import { ClerkProvider } from '@clerk/react';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './lib/auth';
import { BrandingProvider } from './lib/BrandingContext';
import { ThemeProvider, applyTheme, currentTheme } from './lib/theme';
import { ToastProvider } from './components/ui';
import { registerServiceWorker } from './lib/pwa';
import './index.css';

// Paint the right theme before React mounts — no light flash on load.
applyTheme(currentTheme());

registerServiceWorker();

// Clerk (staff sign-in) is opt-in per deployment: the provider mounts only
// when VITE_CLERK_PUBLISHABLE_KEY is present in the frontend build. Without
// it the app renders exactly as before — the password form on /login is the
// only door — and @clerk/react never activates. See docs/RUNBOOK-clerk-setup.md.
const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

function ClerkGate({ children }: { children: React.ReactNode }) {
  if (!clerkPublishableKey) return <>{children}</>;
  return (
    <ClerkProvider publishableKey={clerkPublishableKey} afterSignOutUrl="/">
      {children}
    </ClerkProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <BrandingProvider>
          <ThemeProvider>
            <ToastProvider>
              <ClerkGate>
                <App />
              </ClerkGate>
            </ToastProvider>
          </ThemeProvider>
        </BrandingProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
