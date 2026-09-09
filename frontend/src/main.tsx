import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './lib/auth';
import { BrandingProvider } from './lib/BrandingContext';
import { ToastProvider } from './components/ui';
import { registerServiceWorker } from './lib/pwa';
import './index.css';

registerServiceWorker();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <BrandingProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </BrandingProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
