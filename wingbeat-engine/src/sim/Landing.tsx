import { useEffect, useRef, useState } from 'react';
import './landing.css';
export type EntryMode = 'fullscreen' | 'control' | 'performance' | 'mobile';

// Every way into the piece. `mode` doors open inside this page; the rest are
// their own routes (see main.tsx).
const DOORS: { label: string; title: string; text: string; href: string; mode?: EntryMode; primary?: boolean }[] = [
  { label: 'Experience', title: 'The show.', text: 'Pick a feather, hand out QR codes so phones join as controllers, add a group code, mix the layers and play the sound.', href: '/experience', primary: true },
  { label: 'Mobile experience', title: 'In your hand.', text: 'Compact feather, live meters, camera or microphone as the wind. Made for a phone.', href: '/?mode=mobile', mode: 'mobile', primary: true },
  { label: 'Projection', title: 'On the wall.', text: 'The immersive feather alone, without interface, for a second screen or a projector.', href: '/?mode=fullscreen', mode: 'fullscreen' },
  { label: 'Perform', title: 'On stage.', text: 'Start, hold and settle the encounter with a locked scene and a health readout.', href: '/?mode=performance', mode: 'performance' },
  { label: 'Installation console', title: 'At the desk.', text: 'The full operator console: sensors, routing, scenes, LEDs and presets.', href: '/?mode=control', mode: 'control' },
  { label: 'Feather studio', title: 'Under the glass.', text: 'Photo anatomy, particle material and musical response. Shape a feather and save the scene.', href: '/feather2' },
];

export function Landing({ onPick }: { onPick: (m: EntryMode) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      if (preference.matches) video.current?.pause();
      else void video.current?.play().catch(() => setPlaying(false));
    };
    sync();
    preference.addEventListener('change', sync);
    return () => preference.removeEventListener('change', sync);
  }, []);
  return <main className="wing-home">
    <header className="wing-nav">
      <a href="/" className="wing-wordmark"><span aria-hidden="true"><svg width="23" height="28" viewBox="0 0 24 30" fill="none"><path d="M8 24C2 17 8 4 19 2c2 10-1 19-11 22Z" fill="currentColor" opacity=".85"/><path d="M6 28 17 6M10 19l7-3M12 14l-2-4" stroke="#526c54" strokeWidth="1.2" strokeLinecap="round"/></svg></span>Wing Beat</a>
      <nav><a href="#practice">The practice</a><a href="#enter">Ways in</a><a href="/feather2">Enter studio <span>↗</span></a></nav>
    </header>
    <section className="wing-hero" aria-labelledby="wing-title">
      <div className="wing-motion">
        <video ref={video} muted loop playsInline preload="metadata" poster="/feathers/air-study.png" aria-label="A silver feather moving gently in the air" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}>
          <source src="/creative-assets/feather-motion.mp4" type="video/mp4" />
        </video>
      </div>
      <div className="wing-hero-copy">
        <p className="wing-overline">A FEATHER, AN ENCOUNTER</p>
        <h1 id="wing-title">Give the air<br />a shape.</h1>
        <p>Create a feather. Send a little air.<br />Leave a movement behind.</p>
        <a className="wing-cta" href="/feather2">Enter studio <span>↗</span></a>
        <a className="wing-cta wing-cta-ghost" href="/experience">Experience <span>↗</span></a>
      </div>
      <div className="wing-hero-foot"><a href="#practice">Discover the practice ↓</a><button onClick={() => { if (playing) video.current?.pause(); else void video.current?.play().catch(() => setPlaying(false)); }}>{playing ? 'Pause movement' : 'Play movement'} <span>{playing ? 'Ⅱ' : '▷'}</span></button></div>
    </section>
    <section className="wing-practice" id="practice">
      <div><p className="wing-overline">SMALL GESTURES. LASTING TRACES.</p><h2>A body<br />that remembers.</h2><p>A rooted shaft. A connected vane. Down that yields first and settles last. Each part has a different role.</p></div>
      <div className="wing-practice-steps">{[
        ['Rest', 'Begin with almost nothing.', 'One feather on black. Explore the collection or bring your own photograph.'],
        ['Breath', 'A small gesture is enough.', 'Move the air with your touch. Hold a key, bring a sound, or let your breath lead.'],
        ['Memory', 'Something stays behind.', 'A quieter version of a recent gesture returns. The next movement inherits its residue.'],
      ].map(([label, title, text]) => <article key={label}><span>{label}</span><h3>{title}</h3><p>{text}</p></article>)}</div>
    </section>
    <section className="wing-invitation"><div className="wing-macro"><img src="/feathers/air-study.png" alt="Close view of the silver feather’s fine barbs and soft down" loading="lazy" /></div><div><p className="wing-overline">LOOK A LITTLE CLOSER</p><h2>Make your<br />first feather.</h2><p>Shape, inspect and perform in a real-time studio. Follow the fibres, change their response, and save your scene.</p><a className="wing-text-link" href="/feather2">Enter studio <span>↗</span></a><small>Photo-based depth is an interpretation of the image.</small></div></section>
    <section className="wing-doors" id="enter" aria-labelledby="wing-doors-title">
      <div><p className="wing-overline">WAYS IN</p><h2 id="wing-doors-title">Choose<br />your door.</h2><p>The same feather, met from different distances. For a show, open the experience. On a phone, start with the mobile experience.</p></div>
      <div className="wing-door-list">{DOORS.map((door) => <a key={door.label} className={`wing-door ${door.primary ? 'primary' : ''}`} href={door.href} onClick={(event) => { if (!door.mode) return; event.preventDefault(); onPick(door.mode); }}><span className="wing-door-label">{door.label}</span><strong>{door.title}</strong><small>{door.text}</small><span className="wing-door-arrow">↗</span></a>)}</div>
    </section>
    <footer className="wing-footer"><a href="/" className="wing-wordmark">Wing Beat</a><div>{DOORS.map((door) => <a key={door.label} href={door.href} onClick={(event) => { if (!door.mode) return; event.preventDefault(); onPick(door.mode); }}>{door.label} ↗</a>)}</div><span>A practice of attention.</span></footer>
  </main>;
}
