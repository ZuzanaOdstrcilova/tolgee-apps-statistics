import { Component, StrictMode, type ComponentType, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './App.css'

// Each iframe module is lazy-imported by URL path. The scaffold only
// generates folders for the modules the wizard selected; unselected
// paths show a tiny fallback.
const ROUTES: Record<string, () => Promise<{ default: ComponentType }>> = {
  '/dashboard': () => import('./modules/dashboard'),
  '/tools-panel': () => import('./modules/toolsPanel'),
}

const NotFound = () => (
  <main style={{ padding: 24, fontFamily: 'sans-serif' }}>
    <h2>Statistics</h2>
    <p>
      No module matches <code>{location.pathname}</code>. Add a route in{' '}
      <code>src/main.tsx</code> and a manifest entry in{' '}
      <code>server/manifest.template.json</code>.
    </p>
  </main>
)

// Surface render crashes on the page (and the console) instead of a blank
// white screen — otherwise an uncaught error in any module just unmounts.
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    console.error('[statistics] render crash:', error)
  }
  render() {
    if (this.state.error) {
      return (
        <main style={{ padding: 24, fontFamily: 'monospace', color: '#a11', maxWidth: 900 }}>
          <h2 style={{ margin: '0 0 8px' }}>Render error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
        </main>
      )
    }
    return this.props.children
  }
}

async function mount() {
  const root = createRoot(document.getElementById('root')!)
  const loader = ROUTES[location.pathname]
  if (!loader) {
    root.render(
      <StrictMode>
        <NotFound />
      </StrictMode>
    )
    return
  }
  const { default: Component } = await loader()
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <Component />
      </ErrorBoundary>
    </StrictMode>
  )
}

mount()
