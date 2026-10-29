import Screen, { EmptyState } from '../components/Screen.tsx'

function Settings() {
  return (
    <Screen title="Settings">
      <EmptyState text="API key, currency and backup options are coming soon." />
    </Screen>
  )
}

export default Settings
