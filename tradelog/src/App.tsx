import { lazy, Suspense, useLayoutEffect, useRef } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import CashNotice from './components/CashNotice.tsx'
import Screen from './components/Screen.tsx'
import TabBar from './components/TabBar.tsx'
import UpdateWhenIdle from './components/UpdateWhenIdle.tsx'
import { useLoadedSettings } from './db/settings.ts'
import { AmountsHidden } from './lib/amounts.ts'
import Journal from './screens/Journal.tsx'
import Settings from './screens/Settings.tsx'
import TradeForm from './screens/TradeForm.tsx'
import Watchlist from './screens/Watchlist.tsx'

// Charts are the bulk of the bundle, so they load when Stats is first opened
const Stats = lazy(() => import('./screens/Stats.tsx'))

/** The four tab screens share one scroll area above the bottom tab bar. */
function TabLayout() {
  const main = useRef<HTMLElement>(null)
  const { pathname } = useLocation()

  // Each tab starts at the top instead of inheriting the last tab's scroll
  useLayoutEffect(() => {
    if (main.current) main.current.scrollTop = 0
  }, [pathname])

  return (
    // The notch padding sits outside the scroll area, so scrolled content
    // never slides under the clock in the transparent status bar
    <div className="flex h-full flex-col pt-[env(safe-area-inset-top)]">
      {/* relative: screen-reader labels are absolute, and would otherwise escape
          this panel and make the whole page scrollable */}
      <main
        ref={main}
        className="relative flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
      >
        <Outlet />
      </main>
      <TabBar />
    </div>
  )
}

function App() {
  const settings = useLoadedSettings()
  return (
    // Masked until the setting loads, so hidden amounts never flash on opening
    <AmountsHidden value={settings?.hideAmounts ?? true}>
      <UpdateWhenIdle />
      <CashNotice />
      <Routes>
        <Route element={<TabLayout />}>
          <Route path="/" element={<Journal />} />
          <Route
            path="/stats"
            element={
              <Suspense fallback={<Screen title="Stats" />}>
                <Stats />
              </Suspense>
            }
          />
          <Route path="/watchlist" element={<Watchlist />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        {/* Full-screen form without the tab bar, which would float above the keyboard */}
        <Route path="/trade/new" element={<TradeForm />} />
        <Route path="/trade/:id" element={<TradeForm />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AmountsHidden>
  )
}

export default App
