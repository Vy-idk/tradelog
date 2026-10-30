import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { JournalIcon, SettingsIcon, StatsIcon, WatchlistIcon } from './icons.tsx'

type Tab = { to: string; label: string; icon: ReactNode }

const tabs: Tab[] = [
  { to: '/', label: 'Journal', icon: <JournalIcon /> },
  { to: '/stats', label: 'Stats', icon: <StatsIcon /> },
  { to: '/watchlist', label: 'Watchlist', icon: <WatchlistIcon /> },
  { to: '/settings', label: 'Settings', icon: <SettingsIcon /> },
]

function TabBar() {
  return (
    <nav className="border-t border-border bg-surface px-safe-0 pb-[env(safe-area-inset-bottom)]">
      <ul className="flex">
        {tabs.map((tab) => (
          <li key={tab.to} className="flex-1">
            <NavLink
              to={tab.to}
              end
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 py-2 text-xs ${
                  isActive ? 'text-accent' : 'text-muted'
                }`
              }
            >
              {tab.icon}
              {tab.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export default TabBar
