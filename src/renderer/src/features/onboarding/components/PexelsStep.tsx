import { FormPanel } from './FormPanel'
import { StepCard } from './StepCard'
import { StepHeader } from './StepHeader'
import { StepNav } from './StepNav'

type PexelsStepProps = {
  onBack: () => void
  onNext: () => void
}

export function PexelsStep({ onBack, onNext }: PexelsStepProps): React.JSX.Element {
  return (
    <StepCard>
      <StepHeader
        title={
          <>
            Use <em>Wikimedia Commons</em>
          </>
        }
        description="Search and download freely available photos and video clips from Wikimedia Commons. No media API key is required."
      />
      <FormPanel>
        <div className="rounded-2xl bg-surface-container p-4">
          <p className="text-[13px] leading-relaxed text-on-surface-variant">
            Wikimedia Commons is built in. Search and download media without a separate media account or API key.
          </p>
        </div>
      </FormPanel>
      <StepNav onBack={onBack} onNext={onNext} />
    </StepCard>
  )
}
