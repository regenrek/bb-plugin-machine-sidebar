// Inactive marks on the frontend: loaded from the server, refreshed live when
// any window changes them (realtime signal), and updated optimistically.
import { useCallback, useEffect, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { INACTIVE_CHANGED } from "./tags";
import { NO_INACTIVE_MARKS, type InactiveMarks } from "./tree";

export type SetInactive = (kind: "thread" | "project", id: string, inactive: boolean) => void;

export function useInactiveMarks(): { marks: InactiveMarks; setInactive: SetInactive } {
  const rpc = useRpc<typeof rpcContract>();
  const [marks, setMarks] = useState<InactiveMarks>(NO_INACTIVE_MARKS);

  const refetch = useCallback(() => {
    rpc
      .call("inactive_get", null)
      .then(setMarks)
      .catch(() => undefined);
  }, [rpc]);

  useEffect(refetch, [refetch]);
  useRealtime(INACTIVE_CHANGED, refetch);

  const setInactive = useCallback<SetInactive>(
    (kind, id, inactive) => {
      // Show the move right away; the server's answer (or a refetch) settles it.
      setMarks((current) => {
        const key = kind === "thread" ? "threads" : "projects";
        const next = { ...current[key] };
        if (inactive) next[id] = Date.now();
        else delete next[id];
        return { ...current, [key]: next };
      });
      rpc
        .call("inactive_set", { kind, id, inactive })
        .then(setMarks)
        .catch(refetch);
    },
    [rpc, refetch],
  );

  return { marks, setInactive };
}
