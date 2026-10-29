import Screen, { EmptyState } from '../components/Screen.tsx'

function Watchlist() {
  return (
    <Screen title="Watchlist">
      <EmptyState text="Your watchlist is empty." />
    </Screen>
  )
}

export default Watchlist
