import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { HomePage } from './components/HomePage'
import './styles.css'
import './site.css'
import './theme-dark.css'

const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/'
const isPlayPath = normalizedPath === '/play'
document.title = isPlayPath ? 'WebChess — play the problem' : 'WebChess — change the board'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isPlayPath ? <App /> : <HomePage />}
  </StrictMode>,
)
