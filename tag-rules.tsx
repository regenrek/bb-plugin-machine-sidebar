// Tag rules on the frontend: loaded from the server once, refreshed live when
// the settings page saves (realtime signal), and shared through context.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { tagColorResolver, TAG_RULES_CHANGED, type TagRule } from "./tags";

export function useTagRules() {
  const rpc = useRpc<typeof rpcContract>();
  const [rules, setRules] = useState<TagRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    rpc
      .call("tag_rules_get", null)
      .then((result) => {
        setRules(result.rules);
        setError(null);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [rpc]);

  useEffect(refetch, [refetch]);
  useRealtime(TAG_RULES_CHANGED, refetch);

  const save = useCallback(
    async (next: TagRule[]) => {
      const result = await rpc.call("tag_rules_set", { rules: next });
      setRules(result.rules);
      return result.rules;
    },
    [rpc],
  );

  return { rules, error, save, refetch };
}

const TagColorContext = createContext<(tag: string) => string>(tagColorResolver([]));

export function TagColorProvider({ children }: { children: ReactNode }) {
  const { rules } = useTagRules();
  const resolve = useMemo(() => tagColorResolver(rules ?? []), [rules]);
  return <TagColorContext.Provider value={resolve}>{children}</TagColorContext.Provider>;
}

/** Hex color for a tag: the user's rule, else the automatic color. */
export function useTagColor(): (tag: string) => string {
  return useContext(TagColorContext);
}
