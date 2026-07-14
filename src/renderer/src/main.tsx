import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import Overlay from './pages/Overlay'
import './index.css'

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string | null }> {
  state = { error: null }
  static getDerivedStateFromError(e: Error) { return { error: e.message } }
  render() {
    if (this.state.error) return (
      <div style={{ padding: 40, color: '#e8e0d0', fontFamily: 'sans-serif' }}>
        <strong>App crashed:</strong> {this.state.error}
      </div>
    )
    return this.props.children
  }
}

const isOverlay = window.location.hash.slice(1) === 'overlay'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isOverlay ? <Overlay /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>
)
