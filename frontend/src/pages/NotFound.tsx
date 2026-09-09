import { Link } from 'react-router-dom';
import { Building2, Home, ArrowLeft } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useBranding } from '../lib/BrandingContext';

export default function NotFound() {
  const { token } = useAuth();
  const { supportContacts, tabTitleBrand } = useBranding();
  document.title = `Page not found · ${tabTitleBrand}`;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-100 p-4 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/30">
        <Building2 size={26} strokeWidth={1.75} aria-hidden />
      </span>
      <p className="mt-6 text-sm font-semibold uppercase tracking-widest text-brand-600">Error 404</p>
      <h1 className="mt-1 text-3xl font-bold text-gray-900">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-gray-500">
        The page you're looking for doesn't exist, was moved, or you don't have access to it.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link
          to="/"
          className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-[background-color,transform] duration-150 hover:bg-brand-700 active:scale-[0.96]"
        >
          <Home size={16} strokeWidth={1.75} aria-hidden />
          {token ? 'Back to Dashboard' : 'Back to Sign in'}
        </Link>
        <button
          onClick={() => history.back()}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-[background-color,transform] duration-150 hover:bg-gray-50 active:scale-[0.96]"
        >
          <ArrowLeft size={16} strokeWidth={1.75} aria-hidden />
          Go back
        </button>
      </div>
      {supportContacts.length > 0 && (
        <p className="mt-4 text-xs text-gray-600">
          Need help?{' '}
          {supportContacts.map((c, i) => (
            <span key={c.email}>
              {i > 0 && <span className="mx-1.5 text-gray-400" aria-hidden>·</span>}
              {c.label}:{' '}
              <a
                href={`mailto:${c.email}`}
                className="font-medium text-brand-600 underline-offset-2 transition-colors duration-150 hover:text-brand-700 hover:underline"
              >
                {c.email}
              </a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
