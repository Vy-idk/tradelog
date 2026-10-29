import Screen, { EmptyState } from '../components/Screen.tsx'

function Journal() {
  return (
    <Screen title="Journal">
      <EmptyState text="No trades yet. Trade logging arrives in Phase 1." />
    </Screen>
  )
}

export default Journal
