// ============================================================================
//  Light Engine — the operator surface for the ESP LED nodes.
//
//  Three things an operator standing in a half-built installation actually
//  needs, in this order:
//    1. IS IT CONNECTED — link status and a live packet counter, so "nothing is
//       lighting" can be told apart from "nothing is being sent".
//    2. WHICH STRIP IS WHICH — an Identify button that flashes one node white,
//       bypassing every gate, so a fixture can be found by eye on a rig.
//    3. WHAT IS IT DOING — an output monitor showing the exact commands going
//       on the wire, which makes the patch debuggable with no hardware at all.
//
//  Everything else is patching, and patching is worthless until those three
//  questions can be answered.
// ============================================================================

import { useEffect, useState } from 'react';
import { ledService } from '../led/ledService.ts';
import { ELEMENTS } from '../led/elements.ts';
import type { FeatherPart, HueSource, LedSourceKind } from '../led/types.ts';
import type { LinkStatus } from '../led/LedLink.ts';

const SOURCES: Array<{ id: LedSourceKind; label: string; hint: string }> = [
  { id: 'elements', label: 'Elements', hint: 'driven by the musical elements from /feather2' },
  { id: 'sensor', label: 'Sensor', hint: "the node's own wind, motion and presence" },
  { id: 'mirror', label: 'Mirror', hint: 'echo one anatomical part of the on-screen feather' },
  { id: 'engine', label: 'Engine', hint: 'the engine\'s own shimmer / wind / pulse on melody, presence and scene — the router stays out of it' },
  { id: 'off', label: 'Off', hint: 'dark, but still heartbeated so you know it is alive' },
];
const PARTS: FeatherPart[] = ['rachis', 'vane', 'down', 'markings', 'calamus'];
const HUES: HueSource[] = ['pitch', 'fixed', 'scene'];

function swatch(r: number, g: number, b: number, intensity: number) {
  const k = 0.25 + 0.75 * intensity;
  return `rgb(${Math.round(r * k)}, ${Math.round(g * k)}, ${Math.round(b * k)})`;
}

export function LedPanel() {
  const [, force] = useState(0);
  const [status, setStatus] = useState<LinkStatus>('idle');
  const [newId, setNewId] = useState('');

  useEffect(() => {
    const bump = () => force((x) => x + 1);
    const offChange = ledService.onChange(bump);
    const offTrace = ledService.onTrace(bump);
    const offStatus = ledService.onStatus(setStatus);
    // the counters tick without any event, so poll them slowly
    const id = setInterval(bump, 500);
    return () => {
      offChange();
      offTrace();
      offStatus();
      clearInterval(id);
    };
  }, []);

  const cfg = ledService.config;
  const { sent, dropped } = ledService.link.counters;
  const nodes = ledService.link.discovered;

  return (
    <section className="cond-engine cond-engine-light">
      <div className="cond-engine-head">Light Engine</div>

      {/* ---- 1. is it connected --------------------------------------------- */}
      <div className="cond-led-link">
        <span className={`cond-led-dot ${status}`} title={status} />
        <input
          className="cond-led-url"
          value={cfg.url}
          spellCheck={false}
          onChange={(e) => ledService.setConfig({ url: e.target.value })}
          placeholder="ws://localhost:9001"
        />
        {status === 'connected' ? (
          <button className="wb-btn" onClick={() => ledService.disconnect()}>Disconnect</button>
        ) : (
          <button className="wb-btn" onClick={() => ledService.connect()}>Connect</button>
        )}
      </div>
      <div className="cond-led-stat">
        {status} · sent {sent} · dropped {dropped} · {ledService.fixtures.length} fixture
        {ledService.fixtures.length === 1 ? '' : 's'}
        {location.protocol === 'https:' && cfg.url.startsWith('ws://') && (
          <em className="cond-led-warn">
            {' '}— a page served over HTTPS cannot open a ws:// socket; use wss:// or run from localhost
          </em>
        )}
      </div>

      {/* ---- global ---------------------------------------------------------- */}
      <div className="cond-field-row">
        <label className="cond-field">
          <span>Master {Math.round(cfg.master * 100)}%</span>
          <input type="range" min={0} max={1} step={0.02} value={cfg.master}
            onChange={(e) => ledService.setConfig({ master: +e.target.value })} />
        </label>
        <label className="cond-field">
          <span>Rate {cfg.rateHz} Hz</span>
          <input type="range" min={1} max={30} step={1} value={cfg.rateHz}
            onChange={(e) => ledService.setConfig({ rateHz: +e.target.value })} />
        </label>
      </div>
      <div className="cond-led-row">
        <label className="cond-check">
          <input type="checkbox" checked={cfg.enabled}
            onChange={(e) => ledService.setConfig({ enabled: e.target.checked })} />
          <span>Output</span>
        </label>
        <label className="cond-check">
          <input type="checkbox" checked={cfg.blackout}
            onChange={(e) => ledService.setConfig({ blackout: e.target.checked })} />
          <span>Blackout</span>
        </label>
        <label className="cond-check" title="Let the projection page (/feather2) open the broker link itself when it starts streaming">
          <input type="checkbox" checked={cfg.autoConnect}
            onChange={(e) => ledService.setConfig({ autoConnect: e.target.checked })} />
          <span>Auto-connect</span>
        </label>
        <button className="wb-btn" onClick={() => ledService.allOff()}>All off</button>
      </div>

      {/* ---- 2. the fixtures -------------------------------------------------- */}
      <div className="cond-led-fixtures">
        {ledService.fixtures.length === 0 && (
          <div className="cond-empty">
            No fixtures. Connect to the broker and any node that announces itself is adopted
            automatically, or add one by id below.
          </div>
        )}
        {ledService.fixtures.map((fx) => {
          const disc = nodes.get(fx.id);
          const last = ledService.router.lastSent(fx.id);
          return (
            <div key={fx.id} className="cond-led-fx">
              <div className="cond-led-fx-head">
                <span className={`cond-led-dot ${disc?.online ? 'connected' : 'idle'}`} />
                <b>{fx.label || fx.id}</b>
                {disc?.rssi !== undefined && <span className="cond-sensor-sub">{disc.rssi} dBm</span>}
                <span
                  className="cond-led-swatch"
                  style={{ background: last ? swatch(last.r, last.g, last.b, last.intensity) : '#111' }}
                  title={last ? JSON.stringify(last) : 'nothing sent yet'}
                />
                <button className="wb-btn" title="flash this strip white so you can find it"
                  onClick={() => ledService.identify(fx.id)}>Identify</button>
                <button className="wb-btn" onClick={() => ledService.removeFixture(fx.id)}>✕</button>
              </div>

              <div className="cond-field-row">
                <label className="cond-field">
                  <span>Source</span>
                  <select value={fx.source}
                    onChange={(e) => ledService.updateFixture(fx.id, { source: e.target.value as LedSourceKind })}>
                    {SOURCES.map((s) => <option key={s.id} value={s.id} title={s.hint}>{s.label}</option>)}
                  </select>
                </label>
                {fx.source === 'mirror' && (
                  <label className="cond-field">
                    <span>Part</span>
                    <select value={fx.part}
                      onChange={(e) => ledService.updateFixture(fx.id, { part: e.target.value as FeatherPart })}>
                      {PARTS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </label>
                )}
                {fx.source === 'elements' && (
                  <label className="cond-field">
                    <span>Hue</span>
                    <select value={fx.hueFrom}
                      onChange={(e) => ledService.updateFixture(fx.id, { hueFrom: e.target.value as HueSource })}>
                      {HUES.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </label>
                )}
                <label className="cond-field">
                  <span>Trim {Math.round(fx.gain * 100)}%</span>
                  <input type="range" min={0} max={1} step={0.02} value={fx.gain}
                    onChange={(e) => ledService.updateFixture(fx.id, { gain: +e.target.value })} />
                </label>
              </div>

              {fx.source === 'elements' && (
                <div className="cond-led-gains">
                  {ELEMENTS.map((el) => {
                    const g = fx.gains[el.id] ?? 0;
                    return (
                      <button
                        key={el.id}
                        title={`${el.label} — ${el.hint}`}
                        className={`cond-led-gain ${g >= 1 ? 'full' : g > 0 ? 'half' : ''}`}
                        style={g > 0 && g < 1 ? { opacity: 0.45 + 0.55 * g } : undefined}
                        onClick={() => {
                          const next = g === 0 ? 0.5 : g < 1 ? 1 : 0;
                          const gains = { ...fx.gains };
                          if (next === 0) delete gains[el.id]; else gains[el.id] = next;
                          ledService.updateFixture(fx.id, { gains });
                        }}
                      >
                        {el.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        <div className="cond-led-row">
          <input className="cond-led-url" value={newId} spellCheck={false}
            placeholder="feather_01" onChange={(e) => setNewId(e.target.value.trim())} />
          <button className="wb-btn" disabled={!newId}
            onClick={() => { ledService.addFixture(newId); setNewId(''); }}>Add fixture</button>
        </div>
      </div>

      {/* ---- 3. what is it doing ---------------------------------------------- */}
      <div className="cond-engine-head" style={{ marginTop: 10 }}>Output monitor</div>
      <div className="cond-led-trace">
        {ledService.trace.length === 0 && <div className="cond-empty">nothing sent yet</div>}
        {ledService.trace.slice().reverse().slice(0, 14).map((t, i) => (
          <div key={i} className="cond-led-trace-row">
            <span className="cond-led-swatch sm" style={{ background: swatch(t.cmd.r, t.cmd.g, t.cmd.b, t.cmd.intensity) }} />
            <b>{t.id}</b>
            <span>{t.cmd.mode}</span>
            <span>{Math.round(t.cmd.intensity * 100)}%</span>
            <em>{t.reason}</em>
          </div>
        ))}
      </div>
    </section>
  );
}
