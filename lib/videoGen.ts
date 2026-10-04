export const VIDEO_MODELS = [
  { id: 'veo', label: 'veo (4–8s, audio)' },
  { id: 'seedance', label: 'seedance (2–10s)' },
] as const;

export const VIDEO_DURATIONS = [2, 4, 6, 8, 10];

export type VideoOpts = { model: string; aspect: string; duration: number; seed: string; key: string };

export function defaultVideoOpts(): VideoOpts {
  return { model: 'seedance', aspect: 'landscape', duration: 4, seed: '', key: '' };
}

function clampDuration(model: string, d: number): number {
  if (model === 'veo') return [4, 6, 8].includes(d) ? d : 4;
  return Math.min(10, Math.max(2, Math.round(d) || 4));
}

/** Pollinations video: URL triggers generation (key-gated, Pollen-metered). */
export function buildVideoUrl(prompt: string, opts: { model: string; aspect: string; duration: number; seed: string; key: string }): string {
  const dims = opts.aspect === 'square' ? { w: 768, h: 768 }
    : opts.aspect === 'portrait' ? { w: 720, h: 1280 } : { w: 1280, h: 720 };
  const q = new URLSearchParams({
    model: opts.model,
    width: String(dims.w),
    height: String(dims.h),
    duration: String(clampDuration(opts.model, opts.duration)),
  });
  const s = opts.seed.trim();
  if (s) q.set('seed', s);
  if (opts.key.trim()) q.set('key', opts.key.trim());
  return `https://gen.pollinations.ai/${encodeURIComponent(prompt)}?${q.toString()}`;
}

/** True for values that should render as a playable video. */
export function isVideoValue(v: string): boolean {
  if (!v || v.startsWith('data:')) return false;
  const t = v.trim();
  return /^https?:\/\/\S+$/i.test(t) && (/gen\.pollinations\.ai/i.test(t) || /\.(mp4|webm)(\?|$)/i.test(t));
}
