/**
 * Error boundary (UI crash safety).
 *
 * A rendering error in one screen must never take down the whole launcher.
 * When a page throws, this shows a friendly recovery card: the user can go
 * back to Home or retry, and the full error is written to the on-disk log so
 * it can be debugged later.
 */
import { Component, type ReactNode } from 'react'
import { Button } from './ui'
import { api } from '../lib/api'

interface Props {
  children: ReactNode
  onHome: () => void
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string }): void {
    const stack = error.stack ?? String(error)
    const detail = `${stack}\nComponent stack:\n${info?.componentStack ?? 'n/a'}`
    void api.logs.write('error', `UI screen crashed: ${detail}`).catch(() => {})
  }

  private reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="error-boundary">
        <div className="error-boundary-icon">!</div>
        <h3>This screen hit a problem</h3>
        <p>
          The launcher is still running. You can go back to Home or try loading the screen again.
          The error has been written to the logs for debugging.
        </p>
        <pre className="error-boundary-detail">{String(this.state.error.message || this.state.error)}</pre>
        <div className="row" style={{ justifyContent: 'center', marginTop: 18 }}>
          <Button
            onClick={() => {
              this.reset()
              this.props.onHome()
            }}
          >
            Back to Home
          </Button>
          <Button variant="primary" onClick={this.reset}>
            Try again
          </Button>
        </div>
      </div>
    )
  }
}
