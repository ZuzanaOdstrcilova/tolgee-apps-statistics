import { useEffect, useRef, useState } from 'react'
import {
  createTolgeeApp,
  type TolgeeApp,
  type TolgeeAppSelection,
} from '@tolgee/apps-sdk/browser'

type Origin = 'ai' | 'human'
type TranslationRecord = {
  origin: Origin
  reviewed: boolean
  updatedAt: string
}

const ORIGIN_LABEL: Record<Origin, string> = { ai: 'AI', human: 'Translator' }
const ORIGIN_COLOR: Record<Origin, string> = { ai: '#7c5cff', human: '#16a34a' }

export default function ToolsPanel() {
  const [selection, setSelection] = useState<TolgeeAppSelection>({})
  const [record, setRecord] = useState<TranslationRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const appRef = useRef<TolgeeApp | null>(null)

  useEffect(() => {
    const app = createTolgeeApp()
    appRef.current = app
    app.context.then((ctx) => setSelection(ctx.selection))
    const off = app.onSelectionChanged(setSelection)
    return () => {
      off()
      app.dispose()
      appRef.current = null
    }
  }, [])

  // Fetch the focused translation's standing from our backend.
  useEffect(() => {
    const id = selection.translationId
    if (id == null) {
      setRecord(null)
      return
    }
    const ctrl = new AbortController()
    setLoading(true)
    fetch(`/api/state?ids=${id}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { records: Record<string, TranslationRecord> } | null) => {
        setRecord(data?.records[String(id)] ?? null)
        setLoading(false)
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          console.warn('stats panel fetch:', err)
          setLoading(false)
        }
      })
    return () => ctrl.abort()
  }, [selection.translationId])

  // Keep the host iframe sized to the content.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      appRef.current?.resize(el.scrollHeight)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <main ref={containerRef} className="panel">
      <h2>Statistics</h2>
      {selection.translationId == null ? (
        <p className="panel-hint">Focus a translation cell to see its origin and status.</p>
      ) : loading ? (
        <p className="panel-hint">Loading…</p>
      ) : record == null ? (
        <p className="panel-hint">
          No tracked activity for this translation yet. Edits made while the app is
          installed will appear here.
        </p>
      ) : (
        <div className="panel-card">
          <div className="panel-row">
            <span className="panel-key">Origin</span>
            <span className="badge" style={{ background: ORIGIN_COLOR[record.origin] }}>
              {ORIGIN_LABEL[record.origin]}
            </span>
          </div>
          <div className="panel-row">
            <span className="panel-key">Status</span>
            <span className="panel-val">
              {record.reviewed ? '✓ Reviewed' : 'Awaiting review'}
            </span>
          </div>
          <div className="panel-row">
            <span className="panel-key">Last edit</span>
            <span className="panel-val">
              {new Date(record.updatedAt).toLocaleString()}
            </span>
          </div>
        </div>
      )}
    </main>
  )
}
