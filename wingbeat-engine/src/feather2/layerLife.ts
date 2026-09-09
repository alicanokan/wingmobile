export interface LayerLife {
  lifeMode?: number; // -1 inherit, 0 still, 1 drift, 2 fly, 3 swirl, 4 orbit, 5 pump, 6 wave
  lifeAmount?: number;
  lifeSpeed?: number;
  lifeGlow?: number;
  lifeHue?: number;
}
export const LIFE_MODES = ['Still', 'Organic drift', 'Fly outward', 'Swirl', 'Orbit centre', 'Pump', 'Wave'];
export function resolveLife(layer: LayerLife, master: LayerLife, id: string) {
  const own = layer.lifeMode !== undefined && layer.lifeMode >= 0;
  const config = own ? layer : master;
  const bounded = (n: number | undefined, fallback: number, max: number) => Number.isFinite(n) ? Math.max(0, Math.min(max, n!)) : fallback;
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return {
    mode: Math.round(bounded(config.lifeMode, 1, 6)),
    amount: bounded(config.lifeAmount, 0.12, 2),
    speed: bounded(config.lifeSpeed, 0.45, 3),
    phase: (hash % 1000) / 1000 * Math.PI * 2,
    glow: bounded(config.lifeGlow, 0, 2),
    hue: bounded(config.lifeHue, 0, 1),
  };
}

export const LAYER_LIFE_GLSL = /* glsl */ `
  uniform vec4 uGroupLife[6];
  uniform vec4 uPatternLife[12];
  uniform vec4 uPartLife[5];
  uniform vec2 uGroupLifeLight[6];
  uniform vec2 uPatternLifeLight[12];
  uniform vec2 uPartLifeLight[5];
  varying float vLifeGlow;
  varying float vLifeHue;
  vec3 layerLife(vec3 p, vec4 config, vec2 light, float protection) {
    float mode = config.x;
    float amount = config.y;
    float t = uTime * config.z + config.w;
    float y = clamp((position.y + 1.0) * 0.5, 0.0, 1.0);
    float free = 1.0 - protection;
    vec3 offset = vec3(0.0);
    if (mode > 0.5 && mode < 1.5) {
      offset = vec3(sin(t + position.y * 3.0), cos(t * 0.71 + (position.x - aShaftX) * 5.0), sin(t * 0.83 + y * 4.0)) * 0.09 * free;
    } else if (mode > 1.5 && mode < 2.5) {
      float breath = 0.65 + 0.35 * sin(t + y * 2.0);
      offset = vec3((position.x - aShaftX) * 1.8, y * 0.24, sin(t + position.y * 3.0) * 0.22) * breath * free;
    } else if (mode > 2.5 && mode < 3.5) {
      float radius = max(0.045, abs((position.x - aShaftX)));
      float a = t + y * 5.0 + ((position.x - aShaftX) < 0.0 ? 3.14159 : 0.0);
      offset = vec3(cos(a) * radius - (position.x - aShaftX), sin(a * 0.6) * 0.08, sin(a) * radius) * free;
    } else if (mode > 3.5 && mode < 4.5) {
      float a = t + config.w;
      offset = vec3((position.x - aShaftX) * cos(a) - position.y * sin(a) - (position.x - aShaftX),
        (position.x - aShaftX) * sin(a) + position.y * cos(a) - position.y, sin(t) * 0.12) * free;
    } else if (mode > 4.5 && mode < 5.5) {
      offset = vec3((position.x - aShaftX), position.y * 0.12, 0.08) * sin(t * 2.0) * 0.35 * free;
    } else if (mode > 5.5) {
      offset = vec3(sin(t * 1.7 - y * 3.0) * y * y * 0.09, 0.0, sin(t - y * 5.0) * 0.025 * free);
    }
    // Light and colour remain available on the protected shaft and on Still layers.
    vLifeGlow += light.x * (0.5 + 0.5 * sin(t * 1.4 + y * 2.0));
    vLifeHue += light.y * sin(t * 0.7 + y * 2.0) * 3.14159;
    return p + offset * amount;
  }
`;
