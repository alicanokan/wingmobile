// ============================================================================
//  Landing — shown on every load. Pick how to enter:
//    · Fullscreen  → immersive feather only (projection, no UI)
//    · Control     → the full operator console
//    · Mobile      → compact feather view with the top-right minimal menu
// ============================================================================

import './ui.css';

export type EntryMode = 'fullscreen' | 'control' | 'mobile';

export function Landing({ onPick }: { onPick: (m: EntryMode) => void }) {
  return (
    <div className="wb-landing">
      <div className="wb-landing-title">
        Wing Beat
        <small>engine</small>
      </div>
      <div className="wb-landing-opts">
        <button className="wb-landing-btn" onClick={() => onPick('fullscreen')}>
          <span className="wb-landing-glyph">◐</span>
          Fullscreen
          <small>immersive feather</small>
        </button>
        <button className="wb-landing-btn" onClick={() => onPick('control')}>
          <span className="wb-landing-glyph">▦</span>
          Control
          <small>operator console</small>
        </button>
        <button className="wb-landing-btn" onClick={() => onPick('mobile')}>
          <span className="wb-landing-glyph">⧉</span>
          Mobile experience
          <small>compact · live meters</small>
        </button>
      </div>
    </div>
  );
}
