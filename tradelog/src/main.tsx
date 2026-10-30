import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { startPwa } from './lib/pwa.ts'

// Ask the browser not to evict the journal under storage pressure. iOS usually
// says no (installing to the home screen is the real protection), but it's free.
navigator.storage
  ?.persisted?.()
  .then((persisted) => persisted || navigator.storage.persist())
  .catch(() => {})

startPwa()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Hash routing works on GitHub Pages without a 404 fallback */}
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
