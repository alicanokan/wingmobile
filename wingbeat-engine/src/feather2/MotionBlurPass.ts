import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import type { WebGLRenderer, WebGLRenderTarget } from 'three';

export function temporalWeight(amount: number, delta: number, fresh = false): number {
  if (fresh || !Number.isFinite(amount) || amount <= 0) return 0;
  const dt = Number.isFinite(delta) ? Math.min(.1, Math.max(.001, delta)) : 1 / 60;
  return Math.min(.9, Math.exp(-dt / (.008 + Math.min(1, amount) * .1)));
}

/** Exposure-weighted temporal blur, with bounded, frame-rate-independent history. */
export class MotionBlurPass extends AfterimagePass {
  amount = 0;
  private fresh = true;
  constructor() {
    super(0);
    this.compFsMaterial.fragmentShader = `
      uniform float damp;
      uniform sampler2D tOld;
      uniform sampler2D tNew;
      varying vec2 vUv;
      void main() {
        vec4 current = texture2D(tNew, vUv);
        if (damp <= 0.0) { gl_FragColor = current; return; }
        gl_FragColor = mix(current, texture2D(tOld, vUv), damp);
      }`;
    this.compFsMaterial.needsUpdate = true;
  }
  override setSize(width: number, height: number) {
    super.setSize(width, height);
    this.fresh = true;
  }
  override render(renderer: WebGLRenderer, write: WebGLRenderTarget, read: WebGLRenderTarget, delta = 1 / 60) {
    this.damp = temporalWeight(this.amount, delta, this.fresh);
    super.render(renderer, write, read, delta, false);
    this.fresh = false;
  }
}
