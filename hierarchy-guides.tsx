import { useSettings } from "@get-bb/plugin-sdk/app";
import { HIERARCHY_GUIDES_SETTING } from "./tree";

/** Center of a depth's child toggle (`left: 4 + depth * 14`, 16px wide). */
const guideX = (level: number) => 12 + level * 14;

export function useHierarchyGuides(): boolean {
  return useSettings().values?.[HIERARCHY_GUIDES_SETTING] === true;
}

/**
 * One 1px line per ancestor level, like an editor's file tree. Rows sit flush,
 * so the lines join across rows. The parent must be `relative`.
 */
export function HierarchyGuides({ levels }: { levels: number }) {
  if (levels <= 0) return null;
  return Array.from({ length: levels }, (_, level) => (
    <span key={level} aria-hidden data-hierarchy-guide=""
      style={{ left: guideX(level) }}
      className="pointer-events-none absolute inset-y-0 w-px bg-sidebar-foreground/15" />
  ));
}
