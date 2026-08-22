// ============================================================================
//  ErrorBoundary — the last line between a render-time throw and a black
//  projection. A corrupt preset, a storage exception or a WebGL context loss
//  must end at a legible "reload" screen, not an empty page mid-show.
//
//  Styled inline on purpose: this screen must render even when the app's CSS
//  or state is part of what broke.
// ============================================================================

import { Component, type ReactNode } from 'react';

interface Props {
  /** Which surface died — shown so an operator radioing for help can say it. */
  label: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[wingbeat] ${this.props.label} crashed:`, error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          background: '#0b0a09',
          color: '#e9e3d7',
          fontFamily: 'system-ui, sans-serif',
          padding: 24,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 40 }}>🪶</div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>
          The {this.props.label} hit an error
        </div>
        <div
          style={{
            maxWidth: 560,
            fontSize: 13,
            opacity: 0.7,
            fontFamily: 'ui-monospace, monospace',
            overflowWrap: 'anywhere',
          }}
        >
          {String(this.state.error?.message ?? this.state.error)}
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '10px 22px',
            fontSize: 15,
            borderRadius: 8,
            border: '1px solid #444',
            background: '#1d1916',
            color: '#e9e3d7',
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
        <div style={{ fontSize: 12, opacity: 0.5, maxWidth: 460 }}>
          Saved rigs, presets and routing live in this browser's storage and
          survive a reload. If reloading loops back here, a stored value may be
          corrupt — try a different browser profile and report what you did last.
        </div>
      </div>
    );
  }
}
