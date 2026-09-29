import { SpeakerOutput } from '../../src/engine/SpeakerOutput';
const result = document.querySelector('#results')!;
document.querySelector('#run')!.addEventListener('click', async () => {
  result.textContent = 'Rendering…';
  try {
    const lines = [];
    for (let channel = 0; channel < 4; channel++) {
      const context = new OfflineAudioContext(4, 16000, 16000);
      const output = new SpeakerOutput(context as unknown as AudioContext);
      const oscillator = context.createOscillator(); oscillator.frequency.value = 220;
      output.addSource('test', (node) => { oscillator.connect(node); return () => oscillator.disconnect(node); }, [0, 1, 2, 3].map((i) => Number(i === channel)));
      output.setMaster(1); output.setEnabled(true);
      output.effects({ delay: 0, reverb: 0, highpass: 0, lowpass: 0 }, 0, 120);
      oscillator.start(0); oscillator.stop(0.8);
      const buffer = await context.startRendering();
      const rms = Array.from({ length: 4 }, (_, i) => {
        const samples = buffer.getChannelData(i).slice(4000, 10000);
        return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
      });
      if (rms[channel] < 0.1 || rms.some((v, i) => i !== channel && v > 0.000001)) throw new Error(`Channel ${channel + 1} leaked or stayed silent: ${rms}`);
      lines.push(`PASS output ${channel + 1}: ${rms.map((n) => n.toFixed(6)).join(' / ')}`);
      output.dispose();
    }
    result.textContent = lines.join('\n') + '\nPASS: four independently addressed channels, no cross-channel leakage.';
  } catch (error) { result.textContent = `FAIL: ${String(error)}`; }
});
