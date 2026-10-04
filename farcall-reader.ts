import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { FarcallProjection } from "./farcall-events";

type EventList = BbPluginApi["sdk"]["threads"]["events"]["list"];
/** No timers, workers, filesystem access or durable task copies. */
export function createFarcallReader(list: EventList) {
  const entries = new Map<string, { projection: FarcallProjection; sequence: number; pending?: Promise<void> }>();
  return {
    clear: () => entries.clear(),
    clearThread: (threadId: string) => entries.delete(threadId),
    async read(threadId: string) {
      let entry = entries.get(threadId);
      if (!entry) {
        entry = { projection: new FarcallProjection(), sequence: 0 };
        entries.set(threadId, entry);
      }
      const current = entry;
      const live = () => entries.get(threadId) === current;
      // Serialize reads for the same coordinator; unrelated coordinators remain independent.
      const load = async () => {
        while (live()) {
          const events = await list({ threadId, afterSeq: String(current.sequence), order: "asc", limit: "100",
            types: ["item/started", "item/completed", "turn/completed", "system/thread/interrupted"] });
          if (!live()) return;
          if (events.length === 0) return;
          const sequence = Math.max(...events.map((event) => event.seq));
          if (sequence <= current.sequence) throw new Error("BB-Ereigniscursor ist nicht fortgeschritten.");
          for (const event of events) current.projection.apply(event);
          current.sequence = sequence;
        }
      };
      const pending = (current.pending ?? Promise.resolve()).catch(() => undefined).then(load);
      current.pending = pending;
      await pending;
      return { tasks: live() ? current.projection.snapshot() : [] };
    },
  };
}
