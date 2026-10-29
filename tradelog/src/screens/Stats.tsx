import Screen, { EmptyState } from '../components/Screen.tsx'

function Stats() {
  return (
    <Screen title="Stats">
      <EmptyState text="Stats will appear once you've closed a few trades." />
    </Screen>
  )
}

export default Stats
