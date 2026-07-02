// ============================================================================
//  Phone-camera net protocol. The /cam sender posts these; the console reads
//  them as the "Net" input source. Only motion numbers cross the wire.
// ============================================================================

export interface CamMsg {
  t: 'cam';
  motion: number; // 0..1 enveloped motion energy
  x: number; // 0..1 horizontal centroid
  y: number; // 0..1 vertical centroid
}

/** ws:// (or wss:// on https) URL of the LAN relay, on the current host. */
export function camRelayUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/cam-relay`;
}
