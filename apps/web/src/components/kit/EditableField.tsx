"use client";

import { useEffect, useRef, useState } from "react";

interface EditableFieldProps {
  value: string;
  onSave: (next: string) => Promise<void>;
  multiline?: boolean;
  className?: string;
  label?: string;
  placeholder?: string;
}

/**
 * Section 12: "make reordering and editing feel immediate rather than
 * round-tripping for every keystroke." Typing updates local state only —
 * nothing hits the network until the field is blurred (or Enter, for a
 * single-line field) and the value actually changed. A save in flight
 * disables the field rather than letting a second edit race the first.
 */
export function EditableField({ value, onSave, multiline, className, label, placeholder }: EditableFieldProps) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastSaved = useRef(value);

  useEffect(() => {
    // The kit was refreshed from the server (a regenerate, or another
    // field's save round-trip) — pick up the new value unless the user
    // has an unsaved edit in progress.
    if (!saving && draft === lastSaved.current) {
      setDraft(value);
      lastSaved.current = value;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  async function commit() {
    if (draft === lastSaved.current) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      lastSaved.current = draft;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that change.");
      setDraft(lastSaved.current);
    } finally {
      setSaving(false);
    }
  }

  const sharedProps = {
    value: draft,
    disabled: saving,
    placeholder,
    "aria-label": label,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
    className: `w-full rounded-md border border-transparent bg-transparent px-2 py-1 hover:border-slate-200 focus:border-brand focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-60 ${className ?? ""}`,
  };

  return (
    <div>
      {multiline ? (
        <textarea {...sharedProps} rows={3} />
      ) : (
        <input
          {...sharedProps}
          type="text"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
