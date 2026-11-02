import type { PublicSettings } from '@renderer/lib/store'
import type { SettingsForm } from '../hooks/useSettingsForm'
import { SettingsSection } from './SettingsSection'

interface PexelsPanelProps {
  settings: PublicSettings
  form: SettingsForm
  className?: string
}

export function PexelsPanel({ className }: PexelsPanelProps): React.JSX.Element {
  return (
    <SettingsSection
      id="settings-pexels"
      title="Wikimedia Commons"
      description="The media source for photos and video clips. No API key or connection setup is required."
      className={className}
    >
      <p className="text-[13px] leading-relaxed text-on-surface-variant">
        Wikimedia Commons is ready to use. Search results and downloads are handled automatically.
      </p>
    </SettingsSection>
  )
}
