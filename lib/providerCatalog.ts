export type TextProvider = 'openrouter' | 'gemini' | 'pollinations' | 'huggingface' | 'custom' | 'hour' | 'agnes';

export const TEXT_PROVIDERS: { id: TextProvider; label: string; needsKey: boolean }[] = [
  { id: 'openrouter', label: 'OpenRouter', needsKey: true },
  { id: 'gemini', label: 'Google Gemini', needsKey: true },
  { id: 'pollinations', label: 'Pollinations (no key)', needsKey: false },
  { id: 'huggingface', label: 'Hugging Face', needsKey: true },
  { id: 'hour', label: 'Hour', needsKey: true },
  { id: 'agnes', label: 'Agnes AI', needsKey: true },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', needsKey: true },
];

/** Sensible default model per provider (used when nothing picked yet). */
export const DEFAULT_MODEL: Record<TextProvider, string> = {
  openrouter: 'openrouter/free',
  gemini: 'gemini-2.5-flash',
  pollinations: 'openai',
  huggingface: 'meta-llama/Llama-3.1-8B-Instruct',
  hour: 'hour-chat',
  agnes: 'agnes-1',
  custom: '',
};

/** Pre-configured base URLs for preset providers so users only paste API keys */
export const PRESET_BASE_URLS: Partial<Record<TextProvider, string>> = {
  hour: 'https://api.hour.ai/v1',
  agnes: 'https://api.agnes.ai/v1',
};

/** Full Hub is too big to list — curated open chat models, searched locally. */
const HF_CURATED = [
  'meta-llama/Llama-3.1-8B-Instruct',
  'mistralai/Mistral-7B-Instruct-v0.3',
  'google/gemma-2-9b-it',
  'Qwen/Qwen2.5-7B-Instruct',
  'tiiuae/falcon-7b-instruct',
  'microsoft/Phi-3-mini-4k-instruct',
  'HuggingFaceH4/zephyr-7b-beta',
  '01-ai/Yi-1.5-9B-Chat',
];

const CACHE_PREFIX = 'flowboxes.pcatalog.';
const CACHE_TTL = 24 * 60 * 60 * 1000;

function readCache(provider: TextProvider): string[] | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + provider);
    if (!raw) return null;
    const c = JSON.parse(raw) as { at: number; ids: string[] };
    if (!c || !Array.isArray(c.ids) || Date.now() - c.at >= CACHE_TTL) return null;
    return c.ids;
  } catch {
    return null;
  }
}

function writeCache(provider: TextProvider, ids: string[]) {
  try {
    localStorage.setItem(CACHE_PREFIX + provider, JSON.stringify({ at: Date.now(), ids }));
  } catch {}
}

async function fetchOpenRouterModels(): Promise<string[]> {
  const res = await fetch('https://openrouter.ai/api/v1/models');
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  const data = await res.json();
  const ids = ((data?.data || []) as { id?: string }[])
    .map((m) => m?.id)
    .filter((id): id is string => !!id)
    .sort();
  if (!ids.length) throw new Error('empty catalog');
  return ids;
}

async function fetchGeminiModels(key: string): Promise<string[]> {
  if (!key) throw new Error('Gemini key needed to list models.');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  const data = await res.json();
  const ids = ((data?.models || []) as { name?: string; supportedGenerationMethods?: string[] }[])
    .filter((m) => m?.name && (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name!.replace(/^models\//, ''))
    .sort();
  if (!ids.length) throw new Error('empty catalog');
  return ids;
}

async function fetchPollinationsModels(): Promise<string[]> {
  const res = await fetch('https://text.pollinations.ai/models');
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  const data = await res.json();
  const ids = (Array.isArray(data) ? data : []) as unknown[];
  const out = ids.filter((x): x is string => typeof x === 'string').sort();
  if (!out.length) throw new Error('empty catalog');
  return out;
}

/**
 * Live model slugs for a provider, cached 24h.
 * HF returns a curated list (full Hub is not listable for picking).
 */
export async function fetchProviderModels(provider: TextProvider, key: string): Promise<string[]> {
  const cached = readCache(provider);
  if (cached?.length) return cached;
  let ids: string[];
  if (provider === 'openrouter') ids = await fetchOpenRouterModels();
  else if (provider === 'gemini') ids = await fetchGeminiModels(key.trim());
  else if (provider === 'pollinations') ids = await fetchPollinationsModels();
  else if (provider === 'hour' || provider === 'agnes' || provider === 'custom') return [];
  else ids = [...HF_CURATED];
  writeCache(provider, ids);
  return ids;
}
