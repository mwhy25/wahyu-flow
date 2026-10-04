/** Image-only model catalog, split by backend. Text slugs never belong here. */

export type ImageBackend = 'pollinations' | 'nano-banana' | 'huggingface';

export type ImageModelRef = { id: string; label: string; free: boolean };

export const IMAGE_BACKEND_MODELS: Record<ImageBackend, ImageModelRef[]> = {
  pollinations: [
    { id: 'flux', label: 'flux (free)', free: true },
    { id: 'turbo', label: 'turbo (free)', free: true },
  ],
  'nano-banana': [
    { id: 'gemini-3.1-flash-image', label: 'nano-banana 2 (default)', free: false },
    { id: 'gemini-3.1-flash-lite-image', label: 'nano-banana 2 lite (fast)', free: false },
    { id: 'gemini-3-pro-image', label: 'nano-banana pro (quality)', free: false },
    { id: 'gemini-2.5-flash-image', label: 'nano-banana v1 (legacy)', free: false },
  ],
  huggingface: [
    { id: 'black-forest-labs/FLUX.1-schnell', label: 'FLUX.1-schnell (free tier)', free: true },
  ],
};

/** Backend key from a wired provider id ('gemini' and 'nano-banana' alias). */
export function backendForProvider(provider: string): ImageBackend | null {
  if (provider === 'pollinations') return 'pollinations';
  if (provider === 'gemini' || provider === 'nano-banana') return 'nano-banana';
  if (provider === 'huggingface') return 'huggingface';
  return null;
}

/** Image models for a provider id (wired box or own picker). */
export function imageModelsFor(provider: string): ImageModelRef[] {
  const b = backendForProvider(provider);
  return b ? IMAGE_BACKEND_MODELS[b] : [];
}

/** Guard: reject text-model slugs at Run time. */
export function isImageModel(provider: string, model: string): boolean {
  return imageModelsFor(provider).some((m) => m.id === model);
}
