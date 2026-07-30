import { useRef, useState } from 'react';
import { useStore } from './storeContext';
import { CLASS_LABELS, OP_LABELS } from './labels';
import { OPERAND_CLASSES, type Op } from '../core/questions';
import { exportJSON, importJSON, saveStore } from '../store/persist';
import { freshStore } from '../store/schema';

export function Settings() {
  const { store, update } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const toggleBucket = (id: string) => {
    update((s) => {
      const on = s.settings.enabledBuckets.includes(id);
      const next = on
        ? s.settings.enabledBuckets.filter((b) => b !== id)
        : [...s.settings.enabledBuckets, id];
      if (next.length === 0) return s; // at least one bucket stays enabled
      return { ...s, settings: { ...s.settings, enabledBuckets: next } };
    });
  };

  const download = () => {
    const blob = new Blob([exportJSON(store)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mental-math-trainer-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onImportFile = async (file: File) => {
    const imported = importJSON(await file.text());
    if (imported === null) {
      setImportMsg('Import failed: not a valid export file. Your current data is untouched.');
      return;
    }
    update(() => imported);
    setImportMsg(`Imported ${imported.sessions.length} sessions.`);
  };

  const reset = () => {
    if (window.confirm('Delete ALL local data — stats, PBs, streaks? Export first if unsure.')) {
      const fresh = freshStore();
      saveStore(window.localStorage, fresh);
      update(() => fresh);
    }
  };

  return (
    <div className="page">
      <h2>Settings</h2>
      <p className="micro">Everything is local. No accounts, no sync — export is the backup story.</p>

      <section>
        <h3>Question types (custom sprint · Optiver sim)</h3>
        <div className="bucket-groups">
          {(Object.keys(OPERAND_CLASSES) as Exclude<Op, 'fermi'>[]).map((op) => (
            <div className="bucket-group" key={op}>
              <div className="op-name">{OP_LABELS[op]}</div>
              {OPERAND_CLASSES[op].map((cls) => {
                const id = `${op}:${cls}`;
                return (
                  <label key={id}>
                    <input
                      type="checkbox"
                      checked={store.settings.enabledBuckets.includes(id)}
                      onChange={() => toggleBucket(id)}
                    />
                    {CLASS_LABELS[cls] ?? cls}
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3>Custom sprint duration</h3>
        <div className="field-row">
          <label htmlFor="dur">Seconds</label>
          <select
            id="dur"
            value={store.settings.mode.durationSec}
            onChange={(e) =>
              update((s) => ({
                ...s,
                settings: { ...s.settings, mode: { ...s.settings.mode, durationSec: Number(e.target.value) } },
              }))
            }
          >
            {[30, 60, 120, 300].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <span className="micro">The benchmark sprint is always 120s — custom durations plot as a separate series.</span>
        </div>
      </section>

      <section>
        <h3>Sound</h3>
        <div className="field-row">
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={store.settings.sound}
              onChange={(e) => update((s) => ({ ...s, settings: { ...s.settings, sound: e.target.checked } }))}
            />
            Audio feedback (tick/buzz; a neutral click in the Optiver sim so no verdict leaks)
          </label>
        </div>
      </section>

      <section>
        <h3>Target score (stats chart line)</h3>
        <div className="field-row">
          <label htmlFor="target">Target</label>
          <input
            id="target"
            type="number"
            value={store.settings.targetScore ?? ''}
            placeholder="e.g. 55"
            onChange={(e) =>
              update((s) => ({
                ...s,
                settings: { ...s.settings, targetScore: e.target.value === '' ? null : Number(e.target.value) },
              }))
            }
          />
        </div>
      </section>

      <section>
        <h3>Data</h3>
        <div className="field-row">
          <button type="button" className="btn" onClick={download}>Export JSON</button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>Import JSON</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="visually-hidden"
            aria-label="Import data file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
              e.target.value = '';
            }}
          />
          <button type="button" className="btn danger" onClick={reset}>Reset all data</button>
        </div>
        {importMsg && <p className="micro" style={{ marginTop: '0.6rem' }} aria-live="polite">{importMsg}</p>}
      </section>
    </div>
  );
}
