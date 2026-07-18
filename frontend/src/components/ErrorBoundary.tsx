import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last line of defense: a render-time crash anywhere in the tree would
 * otherwise blank the whole app with no way back except closing the browser.
 * Show a friendly recovery screen with a reload button instead.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error:', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 shadow-soft p-8 text-center space-y-4">
          <div className="w-14 h-14 mx-auto rounded-full bg-red-50 flex items-center justify-center">
            <span className="text-2xl" aria-hidden>
              ⚠️
            </span>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Something went wrong</h1>
            <p className="text-sm text-slate-500 mt-1">
              The app hit an unexpected error. Your saved bills are safe — reload to continue.
            </p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-700 transition-colors"
          >
            Reload App
          </button>
          <details className="text-left">
            <summary className="text-xs text-slate-400 cursor-pointer select-none">
              Technical details
            </summary>
            <pre className="mt-2 text-xs text-slate-500 bg-slate-50 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words">
              {this.state.error.message}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
