// Public surface of the engine package.
export * from './types.ts';
export { WingbeatEngine } from './WingbeatEngine.ts';
export type { EngineConfig } from './WingbeatEngine.ts';
export { AudioEngine } from './AudioEngine.ts';
export { SCENES, SCENE_KEYS, DEFAULT_SCENE, getScene } from './scenes.ts';
export { LAYOUT, nodeSpec, panForNode, perSpeakerGain, nodeGain } from './spatial.ts';
