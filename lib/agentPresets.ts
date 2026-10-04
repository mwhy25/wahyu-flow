export type AgentFieldDef = {
  key: string;
  label: string;
  presets: string[];
  placeholder: string;
  textarea?: boolean;
  /** When true, {{input}} from upstream is interpolated into the manual text. */
  supportsInput?: boolean;
};

export const AGENT_FIELDS: AgentFieldDef[] = [
  { key: 'subject', label: 'Subject', presets: [], placeholder: 'A lone lighthouse on a cliff… (supports {{input}})', textarea: true, supportsInput: true },
  { key: 'style', label: 'Style', presets: ['photographic', 'anime', 'cyberpunk', 'oil painting', 'watercolor', '3D render', 'pixel art', 'pencil sketch', 'cinematic', 'fantasy art'], placeholder: 'Add a custom style…' },
  { key: 'camera', label: 'Camera', presets: ['50mm portrait', 'wide-angle', 'macro', 'drone aerial', 'telephoto', 'fisheye', 'long exposure'], placeholder: 'Add a custom shot…' },
  { key: 'lighting', label: 'Lighting', presets: ['golden hour', 'studio softbox', 'neon glow', 'moonlight', 'volumetric light', 'backlit', 'overcast'], placeholder: 'Add custom lighting…' },
  { key: 'orientation', label: 'Orientation', presets: ['square 1:1', 'portrait 2:3', 'landscape 16:9', 'panorama 21:9'], placeholder: 'Add custom orientation…' },
  { key: 'size', label: 'Size', presets: ['512×512', '1024×1024', '1920×1080', '3840×2160 (4K)'], placeholder: 'Add custom size…' },
  { key: 'mood', label: 'Mood', presets: ['serene', 'dramatic', 'mysterious', 'joyful', 'melancholic', 'epic'], placeholder: 'Add a custom mood…' },
  { key: 'extra', label: 'Extra details', presets: [], placeholder: 'Anything else… (supports {{input}})', textarea: true, supportsInput: true },
  { key: 'negative', label: 'Negative prompt', presets: [], placeholder: 'low quality, blurry, watermark, deformed hands, text, out of frame…', textarea: true },
];

/** Fixed role for the AI-polish pass. */
export const AGENT_SYSTEM =
  'You are an expert image-generation prompt writer. ' +
  'Return ONLY the final refined image prompt, no explanations, no quotes.';

export function defaultAgentState(): Record<string, string> {
  const s: Record<string, string> = {};
  for (const f of AGENT_FIELDS) s[f.key] = '';
  return s;
}
