// Settings → Machine Sidebar: define "[Tag]" names and pick their colors.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useTagRules } from "./tag-rules";
import {
  autoColorId,
  colorHex,
  MAX_TAG_LENGTH,
  MAX_TAG_RULES,
  normalizeRules,
  TAG_PALETTE,
  type TagColorId,
  type TagRule,
} from "./tags";

function TagPill({ tag, color }: { tag: string; color: string }) {
  return (
    <span
      style={{ color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}
      className="inline-block max-w-[12rem] truncate rounded px-1.5 text-xs font-semibold leading-5"
    >
      {tag}
    </span>
  );
}

function ColorSwatches({
  value,
  onChange,
  tag,
}: {
  value: TagColorId;
  onChange: (color: TagColorId) => void;
  tag: string;
}) {
  return (
    <div role="radiogroup" aria-label={`Color for ${tag || "new tag"}`} className="flex gap-1">
      {TAG_PALETTE.map((color) => (
        <button
          key={color.id}
          type="button"
          role="radio"
          aria-checked={value === color.id}
          aria-label={color.label}
          title={color.label}
          onClick={() => onChange(color.id)}
          style={{ background: color.hex }}
          className={cn(
            "size-5 rounded-full ring-offset-2 ring-offset-background transition-shadow",
            value === color.id ? "ring-2 ring-foreground" : "hover:ring-1 hover:ring-muted-foreground",
          )}
        />
      ))}
    </div>
  );
}

function TagSettings() {
  const { rules, error, save } = useTagRules();
  const [draft, setDraft] = useState<TagRule[]>([]);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (rules !== null) setDraft(rules);
  }, [rules]);

  if (rules === null) {
    return (
      <p className="text-sm text-muted-foreground">
        {error === null ? "Loading tags…" : `Could not load tags: ${error}`}
      </p>
    );
  }

  const normalized = normalizeRules(draft);
  const dirty = JSON.stringify(normalized) !== JSON.stringify(rules);
  const duplicates = new Set(
    draft
      .map((rule) => rule.tag.trim().toLowerCase())
      .filter((tag, index, all) => tag !== "" && all.indexOf(tag) !== index),
  );

  const update = (index: number, patch: Partial<TagRule>) => {
    setStatus("idle");
    setDraft((current) => current.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  };

  const onSave = async () => {
    setStatus("saving");
    setSaveError(null);
    try {
      await save(normalized);
      setStatus("saved");
    } catch (cause) {
      setStatus("failed");
      setSaveError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Start a thread title with <code className="rounded bg-muted px-1">[Tag]</code> to show it as
        a pill in the sidebar, e.g. <code className="rounded bg-muted px-1">[Bug] Login fails</code>.
        Tags listed here use the color you pick; other tags get an automatic color. Matching ignores
        upper and lower case.
      </p>

      {draft.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tag colors yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {draft.map((rule, index) => {
            const tag = rule.tag.trim().replace(/^\[|\]$/gu, "").trim();
            const isDuplicate = duplicates.has(tag.toLowerCase());
            return (
              <li key={index} className="flex flex-wrap items-center gap-3">
                <Input
                  value={rule.tag}
                  maxLength={MAX_TAG_LENGTH + 2}
                  placeholder="Tag name"
                  aria-label="Tag name"
                  aria-invalid={isDuplicate || undefined}
                  onChange={(event) => update(index, { tag: event.target.value })}
                  className={cn("h-8 w-40", isDuplicate && "border-destructive")}
                />
                <ColorSwatches
                  tag={tag}
                  value={rule.color}
                  onChange={(color) => update(index, { color })}
                />
                <span className="w-28">{tag !== "" && <TagPill tag={tag} color={colorHex(rule.color)} />}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${tag || "tag"}`}
                  onClick={() => {
                    setStatus("idle");
                    setDraft((current) => current.filter((_, i) => i !== index));
                  }}
                >
                  <Icon name="Trash" fallback="Close" />
                </Button>
                {isDuplicate && (
                  <span className="w-full text-xs text-destructive-text">
                    “{tag}” is listed twice; only the first entry is used.
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={draft.length >= MAX_TAG_RULES}
          onClick={() => {
            setStatus("idle");
            setDraft((current) => [...current, { tag: "", color: autoColorId(String(current.length)) }]);
          }}
        >
          <Icon name="Plus" fallback="Dot" />
          Add tag
        </Button>
        <Button size="sm" disabled={!dirty || status === "saving"} onClick={() => void onSave()}>
          {status === "saving" ? "Saving…" : "Save"}
        </Button>
        {dirty && status !== "saving" && (
          <Button variant="ghost" size="sm" onClick={() => setDraft(rules)}>
            Discard
          </Button>
        )}
        <span role="status" className="text-xs text-muted-foreground">
          {status === "saved" && !dirty ? "Saved. Open windows update right away." : null}
          {status === "failed" ? <span className="text-destructive-text">Could not save: {saveError}</span> : null}
        </span>
      </div>
    </div>
  );
}

export default TagSettings;
