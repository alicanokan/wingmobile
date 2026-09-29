import { useState } from 'react';
import type { AudioEngine } from '../engine/AudioEngine.ts';

export function AudioOutputPanel({ audio }: { audio: AudioEngine }) {
  const [, render] = useState(0);
  const [error, setError] = useState('');
  return <div className="wb-output-panel" style={{ padding: '12px 0' }}>
    <label>Speaker output{' '}
      <select aria-label="Speaker output" value={audio.outputMode} disabled={!audio.ready} onChange={(event) => {
        try { audio.setOutputMode(event.target.value as 'stereo' | 'quad'); setError(''); }
        catch (e) { setError(e instanceof Error ? e.message : 'Could not change speaker output.'); }
        render((v) => v + 1);
      }}>
        <option value="stereo">Stereo</option><option value="quad">Four speakers</option>
      </select>
    </label>
    <p style={{ fontSize: 12, opacity: 0.7 }}>{audio.ready
      ? `${audio.outputChannels} output channels available. Four-speaker order: 1 front left, 2 front right, 3 back left, 4 back right.`
      : 'Start audio to choose an output. Connect the installation interface before opening this page.'}</p>
    {error && <p role="alert">{error}</p>}
  </div>;
}
