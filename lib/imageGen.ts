export type ImageProvider = 'pollinations' | 'nano-banana';

export const IMAGE_PROVIDERS: { id: ImageProvider; label: string }[] = [
  { id: 'pollinations', label: 'Pollinations (free, no key)' },
  { id: 'nano-banana', label: 'Nano-banana (needs Google key)' },
];

export const IMAGE_ASPECTS = [
  { id: 'square', label: 'Square 1:1', w: 1024, h: 1024 },
  { id: 'portrait', label: 'Portrait 2:3', w: 832, h: 1248 },
  { id: 'landscape', label: 'Landscape 16:9', w: 1280, h: 720 },
] as const;

export type ImageOpts = { provider: ImageProvider; model: string; aspect: string; seed: string; negative: string };

export function defaultImageOpts(): ImageOpts {
  return { provider: 'pollinations', model: 'flux', aspect: 'square', seed: '', negative: '' };
}

export function aspectDims(aspect: string): { w: number; h: number } {
  const a = IMAGE_ASPECTS.find((x) => x.id === aspect) || IMAGE_ASPECTS[0];
  return { w: a.w, h: a.h };
}

/** Deterministic Pollinations URL (no key, free). Output is the image itself. */
export function buildPollinationsUrl(prompt: string, aspect: string, seed: string, model = 'flux', negative = ''): string {
  const { w, h } = aspectDims(aspect);
  const q = new URLSearchParams({ width: String(w), height: String(h), model, nologo: 'true' });
  const s = seed.trim();
  if (s) q.set('seed', s);
  const np = negative.trim();
  if (np) q.set('negative_prompt', np);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${q.toString()}`;
}

type GeminiPart = { text?: string; inlineData?: { mimeType?: string; data?: string } };

/** Nano-banana family via Google AI Studio key. Returns a data: URL image. */
export async function generateNanoBanana(prompt: string, googleKey: string, aspect: string, model: string, signal?: AbortSignal): Promise<string> {
  const aspectHint =
    aspect === 'portrait' ? ' Render in vertical portrait 2:3 composition.'
    : aspect === 'landscape' ? ' Render in wide landscape 16:9 composition.'
    : ' Render in square 1:1 composition.';
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': googleKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt + aspectHint }] }] }),
    }
  );
  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = j?.error?.message || JSON.stringify(j).slice(0, 200);
    } catch {
      try { detail = (await res.text()).slice(0, 200); } catch {}
    }
    const hint = res.status === 400 ? ' — bad key or request?'
      : res.status === 429 ? ' — quota spent, resets daily' : '';
    throw new Error(`Gemini ${res.status}${hint}${detail ? ': ' + detail : ''}`);
  }
  const data = await res.json();
  const parts = (data?.candidates?.[0]?.content?.parts || []) as GeminiPart[];
  const img = parts.find((p) => p?.inlineData?.data);
  if (!img?.inlineData?.data) throw new Error('Gemini returned no image (safety block or text-only reply).');
  return `data:${img.inlineData.mimeType || 'image/png'};base64,${img.inlineData.data}`;
}

/** HF FLUX.1-schnell via Inference API. Returns an object (blob:) URL. */
export async function generateHFImage(prompt: string, token: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch('https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ inputs: prompt }),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = (j?.error || JSON.stringify(j)).slice(0, 200);
    } catch {
      try { detail = (await res.text()).slice(0, 200); } catch {}
    }
    if (res.status === 503) throw new Error(`HF model loading, retry in ~20s${detail ? ': ' + detail : ''}.`);
    const err = new Error(`HuggingFace ${res.status}${detail ? ': ' + detail : ''}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  const blob = await res.blob();
  if (!blob.type.startsWith('image/')) throw new Error('HF returned non-image (queued? retry shortly).');
  return URL.createObjectURL(blob);
}

/** True for values that should render as an image thumbnail. */
export function isImageValue(v: string): boolean {
  if (!v) return false;
  if (v.startsWith('data:image/') || v.startsWith('blob:')) return true;
  return /^https?:\/\/\S+$/i.test(v.trim()) && /pollinations|\.(png|jpe?g|webp|gif)(\?|$)/i.test(v);
}
