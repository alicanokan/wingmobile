export const EXPERIENCE_STEPS = [
  { sheet: 'feather', title: 'Choose a feather', hint: 'Pick a feather you like.', next: 'Link controller', icon: 'M5 21L17 5M7 17C2 9 10 2 20 3c1 10-5 17-13 14zM10 14l6-1' },
  { sheet: 'control', title: 'Link a controller', hint: 'Scan a QR code with your phone.', next: 'Try interacting', icon: 'M7 2h10v20H7zM10 18h4M10 6h4v6h-4z' },
  { sheet: 'play', title: 'Interact', hint: 'Use your phone, keys or Test.', next: 'Open mix', icon: 'M9 12V5a2 2 0 014 0v6l3 1 3 3-2 7H9l-5-7a2 2 0 013-2l2 2M5 4L3 2M17 4l2-2' },
  { sheet: 'mix', title: 'Mix', hint: 'Balance the sound layers.', next: 'Ready to play', icon: 'M5 3v6m0 6v6M12 3v10m0 6v2M19 3v2m0 6v10M2 9h6v6H2zM9 13h6v6H9zM16 5h6v6h-6z' },
] as const;
export type ExperienceStep = typeof EXPERIENCE_STEPS[number]['sheet'];

function StepIcon({ path }: { path: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>;
}

export function ExperienceGuide({ onPick, onDismiss }: { onPick: (step: ExperienceStep) => void; onDismiss: () => void }) {
  return <aside className="xp-guide" id="xp-getting-started" aria-labelledby="xp-guide-title">
    <div className="xp-guide-heading"><h2 id="xp-guide-title">Your first Wing Beat</h2><button onClick={onDismiss}>Skip guide <span aria-hidden="true">×</span></button></div>
    <ol>{EXPERIENCE_STEPS.map((step, i) => <li key={step.sheet}>
      <button onClick={() => onPick(step.sheet)} aria-label={`Step ${i + 1}: ${step.title}`}>
        <span className="xp-guide-symbol"><StepIcon path={step.icon} /><span>{i + 1}</span></span>
        <strong>{step.title}</strong><small>{step.hint}</small>
      </button>
    </li>)}</ol>
    <p>Follow the steps, or jump straight in.</p>
  </aside>;
}

export function ExperiencePanelBar({ label, onClose, onSkip }: {
  label: string;
  onClose: () => void;
  onSkip?: () => void;
}) {
  return <div className="xp-sheet-toolbar">
    {onSkip && <button className="xp-skip-guide" onClick={onSkip}>Skip guide</button>}
    <button className="xp-sheet-close" onClick={onClose} aria-label={`Close ${label} panel`}>Close <span aria-hidden="true">×</span></button>
  </div>;
}

export function ExperienceStepHint({ sheet, showDirections, onNext, audioReady, audioBusy, onStartAudio }: {
  sheet: string | null;
  showDirections: boolean;
  onNext: (step: ExperienceStep | null) => void;
  audioReady: boolean;
  audioBusy: boolean;
  onStartAudio: () => void;
}) {
  const index = EXPERIENCE_STEPS.findIndex((step) => step.sheet === sheet);
  if (index < 0) return null;
  const step = EXPERIENCE_STEPS[index];
  const needsSound = !audioReady && (sheet === 'play' || sheet === 'mix');
  if (!showDirections && !needsSound) return null;
  return <div className="xp-step-hint">
    {showDirections && <div className="xp-step-direction"><span className="xp-step-count">{index + 1}<i>/ 4</i></span><p>{step.hint}</p>
      <button onClick={() => onNext(EXPERIENCE_STEPS[index + 1]?.sheet ?? null)}>{step.next} <span aria-hidden="true">{index === 3 ? '✓' : '→'}</span></button>
    </div>}
    {needsSound && <button className="xp-guide-sound" disabled={audioBusy} onClick={onStartAudio}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 9h4l5-4v14l-5-4H3zM16 8q4 4 0 8M19 5q7 7 0 14" /></svg>
      {audioBusy ? 'Starting sound…' : 'Turn on sound'}
    </button>}
  </div>;
}
