import { useMemo, useState } from 'react';

export type PickerOpt = { id: string; label: string; disabled?: boolean; hint?: string };
export type PickerGroup = { label: string; options: PickerOpt[] };

/**
 * Shared OpenRouter-style picker: search box + grouped native select.
 * Same component for the global model, Provider boxes, and anywhere else.
 */
export default function ModelPicker(opts: {
  value: string;
  placeholder?: string;
  groups: PickerGroup[];
  onChange: (id: string) => void;
  title?: string;
  maxShown?: number;
}) {
  const [q, setQ] = useState('');
  const max = opts.maxShown ?? 150;
  const query = q.trim().toLowerCase();
  const groups = useMemo(() => {
    let budget = max;
    return opts.groups
      .map((g) => {
        const list = (query ? g.options.filter((o) => (o.id + ' ' + o.label).toLowerCase().includes(query)) : g.options)
          .slice(0, budget);
        budget -= list.length;
        // keep the current value visible even when filtered out
        const cur = opts.value && !list.some((o) => o.id === opts.value)
          ? g.options.find((o) => o.id === opts.value)
          : undefined;
        return { label: g.label, options: cur ? [cur, ...list] : list };
      })
      .filter((g) => g.options.length);
  }, [opts.groups, query, max, opts.value]);

  return (
    <div className="picker-col">
      <input
        className="field-input picker-search"
        value={q}
        placeholder="search models…"
        spellCheck={false}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => setQ(e.target.value)}
      />
      <select
        className="field-input"
        value={opts.value}
        title={opts.title}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => opts.onChange(e.target.value)}
      >
        <option value="">{opts.placeholder || '— choose a model…'}</option>
        {groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => (
              <option key={o.id} value={o.id} disabled={o.disabled} title={o.hint}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
