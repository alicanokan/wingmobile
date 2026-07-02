// ============================================================================
//  Camera motion source for the simulation.
//
//  Turns the laptop webcam into a contact-free "theremin" sensor. Each frame is
//  downscaled, turned MONOCHROME, contrast-stretched, then DIFFED against the
//  previous frame: every pixel that changed enough becomes a white pixel. The
//  count of white pixels is the motion energy (the "volume" hand), and their
//  horizontal centre is the position (the "pitch" hand). So waving a hand at the
//  screen drives a sensor's wind value through SimTransport.holdWind(), and
//  sliding left↔right sweeps which sensor it plays — the camera stands in for a
//  PIR/optical-flow sensor, the visual sibling of MicSource's breath sensing.
// ============================================================================

export interface CameraReading {
  /** Smoothed motion energy 0..1 (fraction of changed pixels × sensitivity). */
  motion: number;
  /** Horizontal centre of the motion, 0 (left) … 1 (right). 0.5 when still. */
  x: number;
  /** Vertical centre of the motion, 0 (top) … 1 (bottom). 0.5 when still. */
  y: number;
  /** True once motion crosses the presence threshold. */
  present: boolean;
}

// Processing resolution — small is fine (and fast); motion is a coarse signal.
const PW = 96;
const PH = 72;
const N = PW * PH;

export class CameraSource {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private work: HTMLCanvasElement | null = null;
  private wctx: CanvasRenderingContext2D | null = null;
  private prev: Float32Array | null = null; // previous contrast-stretched grayscale

  // Optional live preview of the motion mask.
  private preview: CanvasRenderingContext2D | null = null;
  private mask: ImageData | null = null;

  // Tunables (live-editable from the panel).
  /** Contrast multiplier around mid-gray. 1 = none, higher = punchier. */
  contrast = 1.8;
  /** Per-pixel change (0..255) needed to count as motion. */
  threshold = 24;
  /** Maps the raw changed-pixel fraction into a useful 0..1 range. */
  sensitivity = 8;
  /** Envelope release in seconds — motion rises instantly, falls over this time. */
  releaseTime = 0.4;

  private ema = 0;
  private emaX = 0.5;
  private emaY = 0.5;
  private rel = 0; // post-release (enveloped) motion
  private lastT = 0;

  async start(): Promise<void> {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: 'user' },
      audio: false,
    });
    const video = document.createElement('video');
    video.srcObject = this.stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    this.video = video;

    const work = document.createElement('canvas');
    work.width = PW;
    work.height = PH;
    // willReadFrequently: we getImageData every frame.
    this.wctx = work.getContext('2d', { willReadFrequently: true });
    this.work = work;
    this.mask = this.wctx!.createImageData(PW, PH);
  }

  /** Attach (or detach with null) a canvas to mirror the motion mask onto. */
  attachPreview(canvas: HTMLCanvasElement | null): void {
    this.preview = canvas ? canvas.getContext('2d') : null;
  }

  /** Read one frame. Call once per animation frame. */
  read(): CameraReading {
    const still: CameraReading = { motion: this.ema, x: this.emaX, y: this.emaY, present: false };
    if (!this.video || !this.wctx || this.video.readyState < 2) return still;

    // Mirror horizontally so moving right on screen reads as moving right.
    this.wctx.save();
    this.wctx.scale(-1, 1);
    this.wctx.drawImage(this.video, -PW, 0, PW, PH);
    this.wctx.restore();

    const px = this.wctx.getImageData(0, 0, PW, PH).data;
    const prev = this.prev ?? new Float32Array(N);
    const maskPx = this.mask?.data;

    let changed = 0;
    let sumX = 0;
    let sumY = 0;
    const c = this.contrast;
    const thr = this.threshold;
    const firstFrame = this.prev === null;

    for (let i = 0; i < N; i++) {
      const o = i << 2;
      // Rec.601 luma → monochrome.
      let g = 0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2];
      // Contrast stretch around mid-gray.
      g = (g - 128) * c + 128;
      g = g < 0 ? 0 : g > 255 ? 255 : g;

      const diff = Math.abs(g - prev[i]);
      const hot = !firstFrame && diff > thr;
      if (hot) {
        changed++;
        sumX += i % PW;
        sumY += (i / PW) | 0;
      }
      prev[i] = g;

      if (maskPx) {
        // Dim monochrome background; changed pixels glow white.
        const v = hot ? 255 : g * 0.35;
        maskPx[o] = maskPx[o + 1] = maskPx[o + 2] = v;
        maskPx[o + 3] = 255;
      }
    }
    this.prev = prev;

    if (this.preview && this.mask) {
      this.preview.putImageData(this.mask, 0, 0);
    }

    // Raw fraction of the frame that moved → scaled motion energy.
    const raw = changed / N;
    const motion = Math.min(1, raw * this.sensitivity);
    this.ema = 0.45 * motion + 0.55 * this.ema;

    // Centroid only meaningful when something actually moved; otherwise drift to centre.
    if (changed > N * 0.002) {
      const cx = sumX / changed / (PW - 1);
      const cy = sumY / changed / (PH - 1);
      this.emaX = 0.35 * cx + 0.65 * this.emaX;
      this.emaY = 0.35 * cy + 0.65 * this.emaY;
    } else {
      this.emaX = 0.1 * 0.5 + 0.9 * this.emaX;
      this.emaY = 0.1 * 0.5 + 0.9 * this.emaY;
    }

    // Envelope: instant attack, exponential release over releaseTime seconds.
    const now = (typeof performance !== 'undefined' ? performance.now() : 0);
    const dt = this.lastT ? Math.min(0.1, (now - this.lastT) / 1000) : 1 / 60;
    this.lastT = now;
    const m = Math.min(1, this.ema);
    if (m >= this.rel) this.rel = m;
    else {
      const tau = Math.max(0.02, this.releaseTime);
      this.rel = m + (this.rel - m) * Math.exp(-dt / tau);
    }

    return {
      motion: this.rel,
      x: this.emaX,
      y: this.emaY,
      present: this.rel > 0.04,
    };
  }

  /** Last enveloped motion value, for cheap display without advancing a frame. */
  get lastMotion(): number {
    return this.rel;
  }
  /** Last horizontal centre, for display. */
  get lastX(): number {
    return this.emaX;
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.video?.pause();
    this.stream = null;
    this.video = null;
    this.work = null;
    this.wctx = null;
    this.prev = null;
    this.preview = null;
    this.mask = null;
    this.ema = 0;
    this.emaX = this.emaY = 0.5;
    this.rel = 0;
    this.lastT = 0;
  }

  /** Pixel dimensions of the processing buffer (for sizing a preview canvas). */
  get size(): { w: number; h: number } {
    return { w: PW, h: PH };
  }

  get active(): boolean {
    return this.stream !== null;
  }
}
