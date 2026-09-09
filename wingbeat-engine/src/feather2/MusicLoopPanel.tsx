import { useEffect, useState } from 'react';
import { LOOP_STYLES, MusicLoopPlayer, STEM_NAMES, STEM_TARGETS } from './musicLoops';
export function MusicLoopPanel({ player, onStart, onStatus }: { onStatus: () => void; player: MusicLoopPlayer; onStart: (index: number) => Promise<void> }) {
  const [selected, select] = useState(player.selected), [tick, refresh] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [levels, setLevels] = useState([0, 0, 0, 0, 0]);
  useEffect(() => { const timer = setInterval(() => setLevels(player.read()), 80); return () => clearInterval(timer); }, [player]);
  const change = (fn: () => void) => { fn(); player.update(); refresh(tick + 1); };
  return <details className="f2-depth-controls"><summary>Music test lab · 10 loops / 5 channels</summary>
    <p className="f2-note">Original synth studies · every loop is 16 seconds. Each song opens its own feather.</p>
    <label className="f2-simple-select">Style<select value={selected} disabled={busy} onChange={e => { player.stop(); onStatus(); select(Number(e.target.value)); }}>{LOOP_STYLES.map((style, i) => <option key={style.name} value={i}>{style.name} · {style.bpm} BPM</option>)}</select></label>
    <button className="f2-btn f2-wide" disabled={busy} onClick={async () => { if (player.active) { player.stop(); onStatus(); refresh(tick + 1); return; } setBusy(true); setError(''); try { await onStart(selected); } catch (e) { setError(e instanceof Error ? e.message : 'Could not start loop'); } finally { setBusy(false); refresh(v => v + 1); } }}>{busy ? 'Preparing…' : player.active ? 'Stop loop' : 'Play linked feather'}</button>
    {error && <p role="alert">{error}</p>}
    {STEM_NAMES.map((name, i) => <div className="f2-stem-channel" key={name}>
      <a href={`/music-tests/${selected}-${i}.wav`} download={`${LOOP_STYLES[selected].name}-${name}.wav`} className="f2-note">Download {name} WAV ↗</a>
      <div className="f2-simple-switch"><strong>{name}</strong><button aria-pressed={player.muted[i]} onClick={() => change(() => { player.muted[i] = !player.muted[i]; })}>Mute</button><button aria-pressed={player.solo === i} onClick={() => change(() => { player.solo = player.solo === i ? -1 : i; })}>Solo</button></div>
      <meter aria-label={`${name} signal`} min="0" max="1" value={levels[i]} style={{ width: '100%' }} />
      <label className="f2-simple-slider"><span>Volume<output>{Math.round(player.volumes[i] * 100)}%</output></span><input aria-label={`${name} volume`} type="range" min="0" max="1" step=".01" value={player.volumes[i]} onChange={e => change(() => { player.volumes[i] = Number(e.target.value); })} /></label>
      <label className="f2-simple-select">Moves<select aria-label={`${name} feather layer`} value={player.targets[i]} onChange={e => change(() => { const target = Number(e.target.value), other = player.targets.indexOf(target); if (other >= 0) player.targets[other] = player.targets[i]; player.targets[i] = target; })}>{STEM_TARGETS.map((target, j) => <option key={target} value={j}>{target}</option>)}</select></label>
    </div>)}
    <p className="f2-note">The five channels add motion to your feather. Flight, root attachment and layer controls stay active during playback. Mute and solo affect both sound and layer response. Assignments stay one channel per layer; choosing a used layer swaps the channels.</p>
  </details>;
}
