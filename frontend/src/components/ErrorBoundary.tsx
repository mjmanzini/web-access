import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * React unmounts the whole tree when a render throws. Without a boundary, one
 * bad value in one card — a list endpoint answering with an object instead of
 * an array, say — replaces the entire dashboard with a blank screen, which from
 * the sofa is indistinguishable from "the app is broken" or "that button does
 * nothing". Keep the failure local and say what happened.
 */
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card" role="alert" style={{ borderColor: 'var(--danger)' }}>
        <h2 style={{ marginTop: 0 }}>This page hit a problem</h2>
        <p className="muted" style={{ fontSize: 13 }}>
          {this.state.error.message}
        </p>
        <p className="muted" style={{ fontSize: 13 }}>
          Enforcement keeps running in the background — this is only the
          dashboard.
        </p>
        <button onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
