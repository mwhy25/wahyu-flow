'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { registrySnapshot } from '@/lib/modelRegistry';
import { FREEONLY_LS, MODEL_LS, HOUR_KEY_LS, AGNES_KEY_LS } from '@/lib/providers';
import { useRouter } from 'next/navigation';

type ORModel = {
  id: string;
  name?: string;
  pricing?: { prompt?: string; completion?: string };
  context_length?: number;
};

const per1M = (v?: string) => {
  const n = Number(v || 'NaN');
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return 'free';
  return '$' + (n * 1e6).toFixed(n * 1e6 < 1 ? 3 : 2) + '/1M';
};



export default function ProvidersPage() {
  const router = useRouter();
  const [models, setModels] = useState<ORModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [freeOnly, setFreeOnly] = useState(false);
  const [reg, setReg] = useState<ReturnType<typeof registrySnapshot> | null>(null);

  useEffect(() => {
    try {
      setReg(registrySnapshot(0));
      if (localStorage.getItem(FREEONLY_LS) === '1') setFreeOnly(true);
    } catch {}
    fetch('https://openrouter.ai/api/v1/models')
      .then((r) => r.json())
      .then((d) => setModels(Array.isArray(d?.data) ? d.data : []))
      .catch(() => setModels([]))
      .finally(() => setLoading(false));
  }, []);

  const groups = useMemo(() => {
    const query = q.trim().toLowerCase();
    const map = new Map<string, ORModel[]>();
    for (const m of models) {
      if (!m?.id) continue;
      const free = m.pricing?.prompt === '0' && m.pricing?.completion === '0';
      if (freeOnly && !free) continue;
      if (query && !(m.id + ' ' + (m.name || '')).toLowerCase().includes(query)) continue;
      const org = m.id.includes('/') ? m.id.split('/')[0] : 'other';
      if (!map.has(org)) map.set(org, []);
      map.get(org)!.push(m);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [models, q, freeOnly]);

  const useModel = (id: string) => {
    try {
      localStorage.setItem(MODEL_LS, id);
    } catch {}
    router.push('/');
  };

  return (
    <div style={{padding: 20, maxWidth: 900, margin: '0 auto', overflowY: 'auto', height: '100vh'}}>
      <header style={{display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12}}>
        <Link href="/"><button>← Canvas</button></Link>
        <h2 style={{margin: 0}}>Providers</h2>
      </header>

      <section>
        <h3>Connected providers</h3>
        {reg ? (
          <div style={{
            display: 'grid',
            gap: 12,
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            marginTop: 8,
          }}>
            {reg.providers.map(p => (
              <div
                key={p.id}
                style={{
                  border: '1px solid #2a2e37',
                  borderRadius: 8,
                  padding: 12,
                  background: '#1a1e2a',
                  color: '#e6e8eb',
                }}>
                <h4 style={{margin: 0, marginBottom: 4}}>{p.label}</h4>
                <p style={{fontSize: 12, color: '#888', marginBottom: 4}}>{p.note}</p>
                <div style={{fontSize: 12, marginTop: 4}}>
                <span style={{color: '#6b7280', fontWeight: 500}}>key status: checking…</span>
                </div>
                <button
                  onClick={() => {
                    // simple stub: set a placeholder key localStorage entry so badge shows "key saved"
                    try { localStorage.setItem(p.id === 'hour' ? HOUR_KEY_LS : p.id === 'agnes' ? AGNES_KEY_LS : p.id === 'openrouter' ? 'flowboxes.openrouter.key' : p.id === 'gemini' ? 'flowboxes.google.key' : p.id === 'huggingface' ? 'flowboxes.hf.token' : 'flowboxes.pollinations.key', 'placeholder-key'); } catch {}
                    // reload page to reflect badge
                    window.location.reload();
                  }}
                  style={{
                    marginTop: 8,
                    width: '100%',
                    padding: 6,
                    background: '#3dd68c',
                    border: 'none',
                    borderRadius: 4,
                    color: '#0a0a0a',
                    fontWeight: 500,
                  }}>
                  Set default
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </section>

      <section style={{marginTop: 24}}>
        <h3>Directory (OpenRouter, live models)</h3>
        <p style={{fontSize: 13, color: '#666', marginBottom: 8}}>
          Browse OpenRouter models, filter, and click <b>Use</b> to set a model in the canvas.
        </p>
        <div style={{display: 'flex', gap: 8, marginBottom: 12}}>
          <input
            className="field-input"
            style={{flex: 1}}
            value={q}
            placeholder="search models…"
            spellCheck={false}
            onChange={(e) => setQ(e.target.value)}
          />
          <label className="free-toggle">
            <input
              type="checkbox"
              checked={freeOnly}
              onChange={(e) => setFreeOnly(e.target.checked)}
            /> Free only
          </label>
        </div>
        {loading ? (
          <p className="muted">Loading catalog…</p>
        ) : (
          <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
            {groups.map(([org, list]) => (
              <details key={org} className="prov-row" style={{display: 'block'}}>
                <summary style={{cursor: 'pointer'}}>
                  <strong>{org}</strong> <span className="muted">· {list.length} models</span>
                </summary>
                <div style={{display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8}}>
                  {list.slice(0, 60).map(m => (
                    <div
                      key={m.id}
                      style={{
                        display: 'flex',
                        gap: 8,
                        alignItems: 'center',
                        fontSize: 12,
                      }}>
                        <span style={{flex: 1, wordBreak: 'break-all'}}>
                          {m.id}
                          <span className="muted">
                            · in {per1M(m.pricing?.prompt)} · out {per1M(m.pricing?.completion)} · ctx{
                              m.context_length ? Math.round(m.context_length / 1000) + 'k' : '—'
                            }
                          </span>
                        </span>
                        <button onClick={() => useModel(m.id)} style={{padding: 4, fontSize: 12}}>Use</button>
                      </div>
                    ))}
                    {list.length > 60 && <div className="muted">…{list.length - 60} more (refine search)</div>}
                </div>
              </details>
            ))}
            {!groups.length && <p className="muted">No matches.</p>}
          </div>
        )}
      </section>
    </div>
  );
}
