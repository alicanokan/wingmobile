import { useEffect, useRef, useState } from 'react';
import './landing.css';
export type EntryMode = 'fullscreen' | 'control' | 'performance' | 'mobile';

type Mark = 'hold' | 'air' | 'listen';

/** A small, code-drawn feather keeps the diagrams crisp at every screen size. */
function FeatherDrawing({ coloured = false }: { coloured?: boolean }) {
  return <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M0 54C-32 23-25-27 0-63C27-29 30 20 0 54Z" fill="currentColor" fillOpacity=".045" />
    <path d="M0 69V-57" />
    {[-35, -16, 3, 22, 39].map((y, i) => <g key={y} stroke={coloured ? ['#a9bce0', '#b4c9a5', '#d8bb89', '#c89687', '#b5a2ca'][i] : undefined}>
      <path d={`M0 ${y + 12}Q-13 ${y + 5} ${-([13, 21, 23, 20, 12][i])} ${y - 10}`} />
      <path d={`M0 ${y + 12}Q13 ${y + 5} ${[13, 21, 23, 20, 12][i]} ${y - 10}`} />
    </g>)}
  </g>;
}

function StepIllustration({ kind }: { kind: Mark }) {
  return <svg className={`wing-step-art wing-art-${kind}`} viewBox="0 0 240 200" fill="none" aria-hidden="true">
    {kind === 'hold' && <>
      <g className="wing-feather-sway" transform="translate(129 77) rotate(15)"><FeatherDrawing /></g>
      <g stroke="#bdc8b2" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M45 184L67 164L91 145L111 131Q119 126 126 130Q132 134 126 140L105 157" />
        <path d="M187 184L171 164L157 137Q153 129 145 130L130 135Q124 139 128 144Q131 148 138 146L143 145L146 165" />
        <path d="M105 157Q116 166 133 161L146 155M93 173L105 164M151 171L155 179" opacity=".45" />
        <path d="M114 130Q120 134 119 139M137 135Q135 141 137 146" opacity=".55" />
      </g>
      <circle className="wing-touch-halo" cx="127" cy="136" r="17" stroke="#b5cba2" strokeDasharray="2 6" opacity=".35" />
    </>}
    {kind === 'air' && <>
      <g className="wing-air-lines" stroke="#b8c9b1" strokeWidth="1.5" strokeLinecap="round">
        <path d="M29 69H75Q90 69 90 57Q90 48 81 48" />
        <path d="M16 93H103" /><path d="M33 117H79Q96 117 96 130Q96 139 87 139" />
      </g>
      <g className="wing-feather-sway" transform="translate(153 95) rotate(17)"><FeatherDrawing /></g>
      <path d="M146 168Q177 168 188 144" stroke="#75836f" strokeDasharray="2 5" strokeLinecap="round" />
    </>}
    {kind === 'listen' && <>
      <g stroke="#bdc8b2" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M71 113C55 91 64 53 92 51C126 49 138 83 121 105C113 116 103 117 100 133C97 150 77 151 73 135" />
        <path d="M79 87C77 64 106 64 109 83C111 99 89 99 88 112L94 119" />
        <path d="M154 78Q168 97 154 116M169 66Q190 96 169 128" opacity=".6" className="wing-listen-waves" />
      </g>
      <g className="wing-colour-notes">
        <circle cx="157" cy="151" r="5" fill="#b4c9a5" /><circle cx="175" cy="151" r="5" fill="#d8bb89" /><circle cx="193" cy="151" r="5" fill="#b5a2ca" />
      </g>
    </>}
  </svg>;
}

function CultureDrawing() {
  return <figure className="wing-culture-map" aria-label="Music from different continents flows through a feather into sound, colour and touch.">
    <svg viewBox="0 0 780 300" fill="none" aria-hidden="true">
      <g transform="translate(126 143)" stroke="#91a38e" strokeWidth="1.3">
        <circle r="67" /><ellipse rx="29" ry="67" /><path d="M-66 0H66M-57-34Q0-13 57-34M-57 34Q0 13 57 34" opacity=".5" />
        <path d="M-40-36L-25-43L-16-29L-24-13L-13 0L-19 12L-9 23L-17 46M15-49L31-35L21-24L33-10L19 2L14 29L2 15L-1-8L11-19M32 34L45 28L49 42L35 46Z" strokeWidth="2" />
        <circle cx="-33" cy="-28" r="4" fill="#b5a2ca" stroke="none" /><circle cx="12" cy="-18" r="4" fill="#d8bb89" stroke="none" /><circle cx="35" cy="32" r="4" fill="#c89687" stroke="none" />
      </g>
      <g className="wing-culture-paths" strokeWidth="1.2" strokeLinecap="round">
        <path d="M207 109C255 70 295 79 349 118" stroke="#b5a2ca" />
        <path d="M207 143H344" stroke="#b4c9a5" />
        <path d="M207 177C255 216 295 207 349 168" stroke="#d8bb89" />
        <path d="M429 117C480 81 523 82 568 115M429 169C480 205 523 204 568 174" stroke="#71836a" />
        <path d="M438 143H568M560 139L568 143L560 147" stroke="#b4c9a5" />
      </g>
      <g transform="translate(390 140)">
        <circle r="89" stroke="#b5cba2" strokeOpacity=".1" strokeDasharray="2 8" />
        <g className="wing-feather-sway"><FeatherDrawing coloured /></g>
      </g>
      <g transform="translate(650 143)">
        <circle r="67" stroke="#91a38e" strokeWidth="1.3" />
        <g strokeLinecap="round" strokeWidth="3" className="wing-sound-bars">
          <path d="M-35-7V7" stroke="#a9bce0" /><path d="M-21-18V18" stroke="#b5a2ca" />
          <path d="M-7-31V31" stroke="#b4c9a5" /><path d="M7-22V22" stroke="#d8bb89" />
          <path d="M21-12V12" stroke="#c89687" /><path d="M35-5V5" stroke="#a9bce0" />
        </g>
      </g>
      <g stroke="#a7b59c" strokeWidth="1.4" strokeLinecap="round" opacity=".65">
        <path d="M253 129V118L265 115V126" /><ellipse cx="249" cy="130" rx="4" ry="3" /><ellipse cx="261" cy="127" rx="4" ry="3" />
      </g>
    </svg>
    <figcaption><span>Many continents</span><span>One feather</span><span>A new feeling</span></figcaption>
  </figure>;
}

const TOOLS: { label: string; href: string; mode?: EntryMode; icon: string }[] = [
  { label: 'Mobile', href: '/?mode=mobile', mode: 'mobile', icon: 'M8 3h8v18H8zM11 18h2' },
  { label: 'Projection', href: '/?mode=fullscreen', mode: 'fullscreen', icon: 'M3 4h18v12H3zM12 16v5M7 21h10' },
  { label: 'Perform', href: '/?mode=performance', mode: 'performance', icon: 'M8 4l12 8-12 8z' },
  { label: 'Console', href: '/?mode=control', mode: 'control', icon: 'M5 3v6m0 6v6M12 3v10m0 6v2M19 3v2m0 6v10M2 9h6v6H2zM9 13h6v6H9zM16 5h6v6h-6z' },
  { label: 'Feather studio', href: '/feather2', icon: 'M5 21L17 5M7 17C2 9 10 2 20 3c1 10-5 17-13 14zM10 14l6-1' },
];

export function Landing({ onPick }: { onPick: (m: EntryMode) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [motion, setMotion] = useState(() => !matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const section = location.hash.slice(1);
    if (['practice', 'culture', 'enter'].includes(section)) document.getElementById(section)?.scrollIntoView();
  }, []);
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setMotion(!preference.matches);
    preference.addEventListener('change', sync);
    return () => preference.removeEventListener('change', sync);
  }, []);
  useEffect(() => {
    if (motion) void video.current?.play().catch(() => setMotion(false));
    else video.current?.pause();
  }, [motion]);

  return <main className={`wing-home ${motion ? '' : 'wing-motion-paused'}`}>
    <header className="wing-nav">
      <a href="/" className="wing-wordmark"><span aria-hidden="true"><svg width="23" height="28" viewBox="0 0 24 30" fill="none"><path d="M8 24C2 17 8 4 19 2c2 10-1 19-11 22Z" fill="currentColor" opacity=".85" /><path d="M6 28 17 6M10 19l7-3M12 14l-2-4" stroke="#526c54" strokeWidth="1.2" strokeLinecap="round" /></svg></span>Wing Beat</a>
      <nav aria-label="Main"><a href="#practice">How it feels</a><a href="#culture">The idea</a><a href="/experience">Enter <span aria-hidden="true">↗</span></a></nav>
    </header>

    <section className="wing-hero" aria-labelledby="wing-title">
      <div className="wing-motion"><video ref={video} muted loop playsInline preload="metadata" poster="/feathers/air-study.png" aria-label="A silver feather moving gently in the air"><source src="/creative-assets/feather-motion.mp4" type="video/mp4" /></video></div>
      <div className="wing-hero-copy">
        <p className="wing-overline">A PRACTICE OF ATTENTION</p>
        <h1 id="wing-title">Feel the weight<br />of the air.</h1>
        <p>Hold lightly. Let the air speak.</p>
        <a className="wing-cta" href="#practice">Begin here <span aria-hidden="true">↓</span></a>
      </div>
      <div className="wing-hero-foot"><span>Touch · Air · Sound</span><button aria-pressed={motion} onClick={() => setMotion((value) => !value)}>{motion ? 'Pause motion' : 'Play motion'} <span aria-hidden="true">{motion ? 'Ⅱ' : '▷'}</span></button></div>
    </section>

    <section className="wing-practice" id="practice" aria-labelledby="wing-practice-title">
      <div className="wing-section-head"><p className="wing-overline">YOUR FIRST WING BEAT</p><h2 id="wing-practice-title">Less effort.<br />More feeling.</h2></div>
      <ol className="wing-practice-steps">{([
        ['hold', 'Hold', 'Thumb and index finger. A very light touch.'],
        ['air', 'Feel', 'A gentle breath. Feel the air’s tiny pull.'],
        ['listen', 'Listen', 'Movement becomes sound and colour.'],
      ] as const).map(([kind, title, text], index) => <li key={kind}><span className="wing-step-number">0{index + 1}</span><StepIllustration kind={kind} /><div><h3>{title}</h3><p>{text}</p></div></li>)}</ol>
      <div className="wing-practice-action"><a className="wing-cta" href="/experience">Begin experience <span aria-hidden="true">↗</span></a><p>No feather? Play with touch.</p></div>
    </section>

    <section className="wing-culture" id="culture" aria-labelledby="wing-culture-title">
      <p className="wing-overline">A VESSEL FOR CULTURE</p><h2 id="wing-culture-title">Different worlds.<br />The same air.</h2>
      <CultureDrawing />
      <p className="wing-culture-caption">Music from different continents.<br />Carried in colour, sound and touch.</p>
      <a className="wing-text-link" href="/experience">Feel it <span aria-hidden="true">↗</span></a>
    </section>

    <footer className="wing-footer">
      <div className="wing-footer-line"><a href="/" className="wing-wordmark">Wing Beat</a><span>Hold lightly. Listen closely.</span></div>
      <details className="wing-tools" id="enter"><summary>Studio &amp; installation tools <span aria-hidden="true">＋</span></summary><nav aria-label="Studio and installation">{TOOLS.map((tool) => <a key={tool.label} href={tool.href} onClick={(event) => { if (!tool.mode) return; event.preventDefault(); onPick(tool.mode); }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={tool.icon} /></svg>{tool.label}<span aria-hidden="true">↗</span></a>)}</nav></details>
    </footer>
  </main>;
}
