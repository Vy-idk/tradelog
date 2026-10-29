import { Navigate, Route, Routes } from 'react-router-dom'
import TabBar from './components/TabBar.tsx'
import Journal from './screens/Journal.tsx'
import Settings from './screens/Settings.tsx'
import Stats from './screens/Stats.tsx'
import Watchlist from './screens/Watchlist.tsx'

function App() {
  return (
    <div className="flex h-full flex-col">
      <main className="flex-1 overflow-y-auto pt-[env(safe-area-inset-top)]">
        <Routes>
          <Route path="/" element={<Journal />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/watchlist" element={<Watchlist />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <TabBar />
    </div>
  )
}

export default App
