// ============================================================================
//  Tiny typed event emitter — zero deps, used by the engine bus.
// ============================================================================

import type { EngineEvent, EngineEventType } from './types.ts';

type Payload<T extends EngineEventType> = Extract<EngineEvent, { type: T }>;
type Handler<T extends EngineEventType> = (e: Payload<T>) => void;

export class Emitter {
  private handlers: { [K in EngineEventType]?: Set<Handler<K>> } = {};

  on<T extends EngineEventType>(type: T, handler: Handler<T>): () => void {
    let set = this.handlers[type] as Set<Handler<T>> | undefined;
    if (!set) {
      set = new Set<Handler<T>>();
      this.handlers[type] = set as never;
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  emit(event: EngineEvent): void {
    const set = this.handlers[event.type] as Set<Handler<typeof event.type>> | undefined;
    if (!set) return;
    for (const h of set) (h as (e: EngineEvent) => void)(event);
  }
}
