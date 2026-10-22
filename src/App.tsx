import { Background, BackgroundVariant, ConnectionMode, MiniMap, Panel, ReactFlow, ReactFlowProvider, useNodesInitialized, useReactFlow } from '@xyflow/react'
import { lazy, Suspense, useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Frame, StatusDots } from './components/Frame'
import { Header } from './components/Header'
import { InitPanel } from './components/InitPanel'
import { DeleteDialog, RawEditor, Toast } from './components/Overlays'
import { ProjectSwitcher, SwitchedAway } from './components/ProjectSwitcher'
import { isTyping, useFocusNode } from './hooks'
import { Inspector } from './components/Inspector'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { CardNodeView } from './nodes/CardNodeView'
import { LinkEdgeView, LinkMarkers } from './nodes/LinkEdgeView'
import { useProject } from './store'
import type { CardNode } from './types'

const ArchitecturePage = lazy(() => import('./architecture/ArchitecturePage').then((m) => ({ default: m.ArchitecturePage })))

const nodeTypes = { card: CardNodeView }
const edgeTypes = { link: LinkEdgeView }

const minimapColor = (n: CardNode) => `var(--kind-${n.data.kind})`

function Overview() {
  const count = useProject((s) => s.nodes.length)
  return (
    <Panel position="bottom-right" className="overview">
      <Frame />
      <div className="overview__head">
        <span className="sec-head__tag label-caps">Overview</span>
        <StatusDots rank={3} />
        <span className="mono">{String(count).padStart(3, '0')}</span>
      </div>
      <MiniMap nodeColor={minimapColor} nodeStrokeWidth={0} nodeBorderRadius={4} pannable zoomable />
    </Panel>
  )
}

function FitOnFirstLoad() {
  const ready = useNodesInitialized()
  const { fitView } = useReactFlow()
  const focus = useFocusNode()
  const { pendingFocus, clearPendingFocus } = useProject(useShallow((s) => ({ pendingFocus: s.pendingFocus, clearPendingFocus: s.clearPendingFocus })))
  const done = useRef(false)
  useEffect(() => {
    if (!ready) return
    if (pendingFocus) {
      done.current = true
      clearPendingFocus()
      focus(pendingFocus)
      return
    }
    if (done.current) return
    done.current = true
    fitView({ padding: 0.15 })
  }, [ready, fitView, focus, pendingFocus, clearPendingFocus])
  return null
}

function StatusBanner() {
  const { initialized, loadError, compromised, meta, setInitOpen } = useProject(
    useShallow((s) => ({ initialized: s.initialized, loadError: s.loadError, compromised: s.compromised, meta: s.meta, setInitOpen: s.setInitOpen })),
  )
  const message = compromised
    ? `寫入鎖已失效，已停止寫入：${compromised}`
    : loadError
      ? `無法連線到 Nodit server：${loadError}`
      : meta && !initialized
        ? '這個專案尚未初始化（找不到 nodit.config.json），目前以預設路徑讀取'
        : null
  if (!message) return null
  return (
    <div className="banner">
      {message}
      {meta && !initialized && !compromised && !loadError && (
        <button type="button" className="btn btn--primary" onClick={() => setInitOpen(true)}>
          開始 init
        </button>
      )}
    </div>
  )
}

function Canvas() {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, onNodeDragStop, theme, tool } = useProject(
    useShallow((s) => ({
      nodes: s.nodes,
      edges: s.edges,
      onNodesChange: s.onNodesChange,
      onEdgesChange: s.onEdgesChange,
      onConnect: s.onConnect,
      onNodeDragStop: s.onNodeDragStop,
      theme: s.theme,
      tool: s.tool,
    })),
  )
  const hand = tool === 'hand'

  return (
    <ReactFlow
      className={hand ? 'is-hand' : undefined}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeDragStop={onNodeDragStop}
      connectionMode={ConnectionMode.Loose}
      connectionLineStyle={{ stroke: 'var(--accent)', strokeWidth: 1.5, strokeDasharray: '4 4' }}
      deleteKeyCode={null}
      panOnDrag={hand ? true : [1, 2]}
      selectionOnDrag={!hand}
      panOnScroll
      nodesDraggable={!hand}
      nodesConnectable={!hand}
      elementsSelectable={!hand}
      colorMode={theme}
      minZoom={0.2}
      maxZoom={2}
      fitView
      fitViewOptions={{ padding: 0.15 }}
    >
      <Background id="dots" variant={BackgroundVariant.Dots} gap={24} size={1.5} color="var(--grid-dot)" />
      <Background id="grid" variant={BackgroundVariant.Lines} gap={192} color="var(--grid-line)" />
      <Overview />
      <FitOnFirstLoad />
    </ReactFlow>
  )
}

function useDeleteKey() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'Delete' && e.key !== 'Backspace') || isTyping(e.target)) return
      const s = useProject.getState()
      if (s.rawDocKey || s.deleteRequest) return
      const nodes = s.nodes.filter((n) => n.selected)
      const edges = s.edges.filter((x) => x.selected)
      if (nodes.length === 1 && !edges.length) s.requestDelete(nodes[0].id)
      else if (edges.length === 1 && !nodes.length) void s.removeEdge(edges[0].id)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export default function App() {
  const theme = useProject((s) => s.theme)
  const view = useProject((s) => s.view)
  const canvasEpoch = useProject((s) => s.canvasEpoch)
  useDeleteKey()

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  return (
    <ReactFlowProvider>
      <div className="app">
        <Sidebar />
        <div className="workspace">
          <Header />
          <main className="stage">
            {view === 'graph' ? (
              <>
                <Canvas key={canvasEpoch} />
                <Toolbar />
                <Inspector />
              </>
            ) : (
              <Suspense fallback={null}>
                <ArchitecturePage />
              </Suspense>
            )}
            <StatusBanner />
            <Toast />
          </main>
        </div>
      </div>
      <RawEditor />
      <DeleteDialog />
      <InitPanel />
      <ProjectSwitcher />
      <SwitchedAway />
      <LinkMarkers />
    </ReactFlowProvider>
  )
}
