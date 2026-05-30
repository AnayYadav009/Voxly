import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('Boundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="app-card border-2 border-red-200 p-6">
          <p className="text-red-700 font-semibold">
            {this.props.fallback || 'This section failed to load.'}
          </p>
          <button
            type="button"
            className="mt-3 text-sm text-blue-600 underline"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
