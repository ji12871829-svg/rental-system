import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Toon } from './Toon';

/*
 * Error boundary — the last line of defense for unexpected React crashes.
 *
 * Without it a render-time exception white-screens the app; with it the
 * visitor gets the mascot, an honest explanation, and the route out. The
 * boundary resets when the route changes (the crash belonged to the page
 * the visitor is leaving) and can offer a full reload for the staff side,
 * where the whole app shell is down.
 *
 * Class component by necessity: error boundaries are the one thing React
 * still only implements with lifecycles.
 */

interface Props {
  /** What crashed, for the visitor and for honest reporting. */
  surface: string;
  /** Full-reload action for shell-level boundaries (staff app). */
  shell?: boolean;
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Aggregate errors surface "non-error thrown" without a stack — include
    // the component stack so the report says where, not just that.
    console.error(
      `[${this.props.surface}] React render error:`,
      error,
      '\nComponent stack:',
      info.componentStack,
    );
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
        <Toon size={110} pose="wave" animated />
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Something went wrong on this page</h2>
          <p className="mt-1 max-w-md text-sm leading-6 text-graphite">
            An unexpected error interrupted the {this.props.surface}. Your data is safe on the server —
            {this.props.shell ? ' reload the page to get back in.' : ' the rest of the portal still works.'}
          </p>
        </div>
        {this.props.shell ? (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="press inline-flex min-h-[44px] items-center rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-[background-color,color] hover:bg-brand-600"
          >
            Reload the app
          </button>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <Link
              to="/portal"
              className="press inline-flex min-h-[44px] items-center rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-[background-color,color] hover:bg-brand-600"
            >
              Back to portal home
            </Link>
            {/* Works even when the crash is on /portal itself, where the SPA
                link above would be a same-route no-op. */}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="text-xs font-medium text-graphite underline underline-offset-2 transition-colors duration-150 hover:text-black"
            >
              or reload the page
            </button>
          </div>
        )}
      </div>
    );
  }
}

/** Binds the reset-on-navigation behavior to the router's location. */
export function ErrorBoundaryWithReset(props: Omit<Props, 'children'> & { children: ReactNode }) {
  const location = useLocation();
  // The key remounts the boundary (clearing its error state) whenever the
  // route changes, so recovery is "navigate anywhere" — no reload needed.
  return <ErrorBoundary key={location.pathname} {...props} />;
}
