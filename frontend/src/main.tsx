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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <BrandingProvider>
          <ThemeProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </ThemeProvider>
        </BrandingProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
