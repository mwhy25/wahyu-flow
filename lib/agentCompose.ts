import { AGENT_FIELDS } from './agentPresets';

export function interpolate(template: string, inputVal: string): string {
  if (!template) return '';
  if (template.includes('{{input}}')) return template.split('{{input}}').join(inputVal);
  return inputVal ? template + '\n' + inputVal : template;
}

/**
 * Build the deterministic draft from agent fields.
 * Only non-empty fields become "Label: value" lines.
 */
export function composeAgentDraft(agent: Record<string, string>, inputVal: string): string {
  const lines: string[] = [];
  for (const f of AGENT_FIELDS) {
    const raw = (agent?.[f.key] || '').trim();
    if (!raw) continue;
    const val = f.supportsInput ? interpolate(raw, inputVal) : raw;
    if (!val.trim()) continue;
    lines.push(f.key === 'negative' ? `Avoid: ${val.trim()}` : `${f.label}: ${val.trim()}`);
  }
  return lines.join('\n');
}
