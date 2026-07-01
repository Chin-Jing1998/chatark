import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'

// macOS 走原生 vibrancy：给根节点打标记，让样式层把外壳背景改为透明以透出桌面磨砂
if (window.api.platform === 'darwin') document.documentElement.classList.add('is-mac')

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('根节点 #root 缺失')

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
