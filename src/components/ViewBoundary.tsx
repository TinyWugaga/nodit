import { RotateCw } from 'lucide-react'
import { Component, type ReactNode } from 'react'

/** Keeps a crashed view (or a lazy chunk that failed to load) from unmounting the whole app. */
export class ViewBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown) {
    console.error(error)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="view-error arch__empty">
        <p>這個頁面載入失敗：</p>
        <pre className="code">
          <code>{error.message}</code>
        </pre>
        <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
          <RotateCw size={14} />
          重新載入
        </button>
      </div>
    )
  }
}
