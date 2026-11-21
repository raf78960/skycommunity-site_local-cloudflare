import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { Toaster } from './components/ui/sonner'
import { queryClient } from './lib/queryClient'
import { loadLang, useLang } from './lib/i18n'

// Safari on iPhone / iPad ignores « user-scalable=no »: its pinch-zoom of the whole page is blocked here
// (the map still zooms: Leaflet works with touch events, not these gesture events).
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false })
}
// Chrome / Firefox / Edge sur ordinateur : le pincement du trackpad arrive comme une molette avec « ctrl » et
// zoomerait toute la page. On le bloque partout ; sur la carte, Leaflet le reçoit avant et zoome la carte.
document.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault() }, { passive: false })

/** The app is re-rendered once when the language changes (FR / EN); the page and the data stay. */
function Root() {
  const lang = useLang()
  return (
    <BrowserRouter>
      <App key={lang} />
      {/* success / error notifications (toast.*) */}
      <Toaster richColors closeButton duration={4500} />
    </BrowserRouter>
  )
}

// French needs nothing; the English dictionary is downloaded first only for someone who picked English
void loadLang().finally(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <Root />
      </QueryClientProvider>
    </StrictMode>,
  ),
)

// Installable app (« Ajouter à l'écran d'accueil »): the service worker only exists on the published site.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
