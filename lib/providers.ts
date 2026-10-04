export type ProviderModel = { id: string; label: string; free: boolean };

/** Rot-proof fallback: OpenRouter picks a working free model per request. */
export const FREE_ROUTER = 'openrouter/free';

export const PAID_MODELS: ProviderModel[] = [
  { id: 'openai/gpt-4o-mini', label: 'gpt-4o-mini', free: false },
  { id: 'anthropic/claude-3.5-haiku', label: 'claude-3.5-haiku', free: false },
  { id: 'google/gemini-flash-1.5', label: 'gemini-flash-1.5', free: false },
  { id: 'meta-llama/llama-3.1-8b-instruct', label: 'llama-3.1-8b', free: false },
];

/** Static safety net when the live catalog can't be fetched. */
const STATIC_FREE_FALLBACK: string[] = [FREE_ROUTER];

const CATALOG_LS = 'flowboxes.freeCatalog';
const CATALOG_TTL = 24 * 60 * 60 * 1000;

type CatalogCache = { at: number; ids: string[] };

function readCatalogCache(): CatalogCache | null {
  try {
    const raw = localStorage.getItem(CATALOG_LS);
    if (!raw) return null;
    const c = JSON.parse(raw) as CatalogCache;
    if (!c || !Array.isArray(c.ids) || Date.now() - c.at >= CATALOG_TTL) return null;
    return c;
  } catch {
    return null;
  }
}

/** Short display label for a model slug, e.g. "a/b:free" -> "b (free)". */
export function shortLabel(id: string): string {
  if (id === FREE_ROUTER) return 'auto (free router)';
  const noTag = id.replace(/:free$/, '');
  const parts = noTag.split('/');
  return parts[parts.length - 1] + (id.endsWith(':free') ? ' (free)' : '');
}

type ORModel = { id: string; pricing?: { prompt?: string; completion?: string } };

/**
 * Live list of free model slugs from OpenRouter's public catalog
 * (pricing.prompt == 0 && pricing.completion == 0), cached 24h.
 * Falls back to [openrouter/free] when offline or on error.
 */
export async function fetchFreeModels(force = false): Promise<string[]> {
  if (!force) {
    const cached = readCatalogCache();
    if (cached && cached.ids.length) return cached.ids;
  }
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models');
    if (!res.ok) throw new Error(`catalog ${res.status}`);
    const data = await res.json();
    const ids = ((data?.data || []) as ORModel[])
      .filter((m) => m?.id && m.pricing?.prompt === '0' && m.pricing?.completion === '0')
      .map((m) => m.id);
    if (!ids.length) throw new Error('empty catalog');
    const withRouter = [FREE_ROUTER, ...ids.filter((id) => id !== FREE_ROUTER)];
    try {
      localStorage.setItem(CATALOG_LS, JSON.stringify({ at: Date.now(), ids: withRouter } satisfies CatalogCache));
    } catch {}
    return withRouter;
  } catch {
    return [...STATIC_FREE_FALLBACK];
  }
}

const LIMITED_PREFIX = 'flowboxes.limited.';
const DAY_MS = 24 * 60 * 60 * 1000;

export function markModelLimited(modelId: string) {
  try {
    localStorage.setItem(LIMITED_PREFIX + modelId, String(Date.now()));
  } catch {}
}

function limitedAt(modelId: string): number {
  try {
    return Number(localStorage.getItem(LIMITED_PREFIX + modelId) || 0);
  } catch {
    return 0;
  }
}

/** True when the model hit a limit within the last 24h (free quotas reset daily). */
export function isFreshlyLimited(modelId: string): boolean {
  const at = limitedAt(modelId);
  return !!at && Date.now() - at < DAY_MS;
}

export function clearStaleLimits() {
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(LIMITED_PREFIX)) continue;
      const at = Number(localStorage.getItem(k) || 0);
      if (at && Date.now() - at >= DAY_MS) stale.push(k);
    }
    for (const k of stale) localStorage.removeItem(k);
  } catch {}
}

export const KEY_LS = 'flowboxes.openrouter.key';
export const GKEY_LS = 'flowboxes.google.key';
export const HFKEY_LS = 'flowboxes.hf.token';
export const POLLEN_LS = 'flowboxes.pollinations.key';
export const FREEONLY_LS = 'flowboxes.freeOnly';
export const HOUR_KEY_LS = 'flowboxes.hour.key';
export const AGNES_KEY_LS = 'flowboxes.agnes.key';

/** Split stored key text (one per line) into usable keys. Back-compat with single keys. */
export function splitKeys(raw: string): string[] {
  return raw.split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean);
}

/** True for quota errors worth retrying with the NEXT key (not the same one). */
export function isQuotaError(err: unknown): boolean {
  const s = (err as { status?: number })?.status;
  return s === 429 || s === 402 || s === 503;
}

/** Try keys in order; on quota errors move to the next key. */
export async function tryKeys<T>(
  keys: string[],
  label: string,
  onTry: (key: string, i: number) => Promise<T>,
  onNote?: (msg: string) => void
): Promise<{ value: T; keyIndex: number }> {
  let lastErr: unknown = null;
  const list = keys.filter(Boolean);
  for (let i = 0; i < list.length; i++) {
    try {
      return { value: await onTry(list[i], i), keyIndex: i };
    } catch (err) {
      lastErr = err;
      if (i < list.length - 1 && isQuotaError(err)) {
        onNote?.(`${label}: key #${i + 1} exhausted, trying key #${i + 2}…`);
        continue;
      }
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('All keys exhausted.');
}

/** Human summary of models cooling down, e.g. "2 cooling (~3h)". Empty when clear. */
export function coolingSummary(): string {
  const items: { until: number }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(LIMITED_PREFIX)) continue;
      const at = Number(localStorage.getItem(k) || 0);
      const left = at ? at + DAY_MS - Date.now() : 0;
      if (left > 0) items.push({ until: left });
    }
  } catch {}
  if (!items.length) return '';
  const worst = Math.max(...items.map((x) => x.until));
  return `${items.length} cooling (~${Math.max(1, Math.ceil(worst / 3600000))}h)`;
}
export const MODEL_LS = 'flowboxes.openrouter.model';
