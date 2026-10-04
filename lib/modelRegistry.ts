import { GKEY_LS, HFKEY_LS, KEY_LS, POLLEN_LS, coolingSummary } from './providers';
import { IMAGE_BACKEND_MODELS, type ImageBackend } from './imageModels';
import { VIDEO_MODELS } from './videoGen';

export type RegistryProvider = {
  id: string;
  label: string;
  kinds: ('text' | 'image' | 'video')[];
  keyPresent: boolean;
  keyName: string;
  textCount: number | null; // null = loads per box
  imageCount: number;
  videoCount: number;
  note: string;
};

function has(key: string): boolean {
  try {
    return !!(localStorage.getItem(key) || '').trim();
  } catch {
    return false;
  }
}

/** One registry snapshot for the Providers menu. Counts only, no secrets. */
export function registrySnapshot(orFreeCount: number): { providers: RegistryProvider[]; cooling: string } {
  return {
    providers: [
      {
        id: 'openrouter', label: 'OpenRouter', kinds: ['text'],
        keyPresent: has(KEY_LS), keyName: 'OpenRouter key',
        textCount: orFreeCount, imageCount: 0, videoCount: 0,
        note: 'Free quotas reset daily. Paid models optional.',
      },
      {
        id: 'gemini', label: 'Google Gemini', kinds: ['text', 'image'],
        keyPresent: has(GKEY_LS), keyName: 'Google key',
        textCount: null, imageCount: IMAGE_BACKEND_MODELS['nano-banana'].length, videoCount: 0,
        note: 'Nano-banana draws project quota (limit 0 = new project needed).',
      },
      {
        id: 'pollinations', label: 'Pollinations', kinds: ['text', 'image', 'video'],
        keyPresent: has(POLLEN_LS), keyName: 'Pollinations key (video only)',
        textCount: null,
        imageCount: IMAGE_BACKEND_MODELS['pollinations'].length,
        videoCount: VIDEO_MODELS.length,
        note: 'flux/turbo keyless (throttled). Video is Pollen-metered.',
      },
      {
        id: 'huggingface', label: 'Hugging Face', kinds: ['text', 'image'],
        keyPresent: has(HFKEY_LS), keyName: 'HF token',
        textCount: 8, imageCount: IMAGE_BACKEND_MODELS['huggingface'].length, videoCount: 0,
        note: 'Free inference tier, separate quota from Google.',
      },
      {
        id: 'hour', label: 'Hour', kinds: ['text'],
        keyPresent: false, keyName: 'Hour API key',
        textCount: null, imageCount: 0, videoCount: 0,
        note: 'OpenAI-compatible chats API. Paste your key to enable.',
      },
      {
        id: 'agnes', label: 'Agnes AI', kinds: ['text'],
        keyPresent: false, keyName: 'Agnes API key',
        textCount: null, imageCount: 0, videoCount: 0,
        note: 'OpenAI-compatible chats API. Paste your key to enable.',
      },
    ],
    cooling: coolingSummary(),
  };
}

export function providerLabel(id: string): string {
  return id === 'openrouter' ? 'OpenRouter'
    : id === 'gemini' ? 'Google Gemini'
    : id === 'pollinations' ? 'Pollinations'
    : id === 'huggingface' ? 'Hugging Face'
    : id;
}
