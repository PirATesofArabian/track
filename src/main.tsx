import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { startAutoSync } from './lib/sync'

startAutoSync()
// Ask the browser to keep this site's data. Without it, a phone can clear IndexedDB (custom foods, exercises, photos) when it is short of space or the site is unused for a while.
void navigator.storage?.persist?.().catch(() => undefined)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
