import { defaultImageOpts } from './imageGen';
import { DEFAULT_MODEL } from './providerCatalog';

export const CANVAS_LS = 'flowboxes.canvas.v1';

export type SavedCanvas = {
  version: 1;
  model: string;
  nodes: unknown[];
  edges: unknown[];
};

function isNode(x: unknown): boolean {
  const n = x as Record<string, unknown>;
  return !!n && typeof n.id === 'string' && typeof n.type === 'string'
    && typeof n.x === 'number' && typeof n.y === 'number';
}

function isEdge(x: unknown): boolean {
  const e = x as Record<string, unknown>;
  return !!e && typeof e.id === 'string' && typeof e.from === 'string' && typeof e.to === 'string';
}

/** Parse + validate imported/restored canvas JSON. Returns null when invalid. */
export function parseCanvas(raw: string): SavedCanvas | null {
  try {
    const c = JSON.parse(raw) as Partial<SavedCanvas>;
    if (!c || c.version !== 1 || !Array.isArray(c.nodes) || !Array.isArray(c.edges)) return null;
    if (!c.nodes.every(isNode) || !c.edges.every(isEdge)) return null;
    return { version: 1, model: typeof c.model === 'string' ? c.model : '', nodes: c.nodes, edges: c.edges };
  } catch {
    return null;
  }
}

export function serializeCanvas(nodes: unknown[], edges: unknown[], model: string): string {
  return JSON.stringify({ version: 1, model, nodes: forSave(nodes), edges } satisfies SavedCanvas);
}

/** Drop edges that point at ports which no longer exist (e.g. old extra→image). */
export function sanitizeEdges(
  nodes: { id: string; type: string }[],
  edges: { id: string; from: string; to: string; toPort?: string }[]
): { id: string; from: string; to: string; toPort?: string }[] {
  const PORTS: Record<string, string[]> = {
    image: ['prompt', 'provider'],
    video: ['prompt', 'extra'],
    agent: ['in', 'provider'],
  };
  const typeOf = new Map(nodes.map((n) => [n.id, n.type]));
  return edges.filter((e) => {
    if (!typeOf.get(e.from) || !typeOf.get(e.to)) return false;
    const allowed = PORTS[typeOf.get(e.to) as string] || ['in'];
    return allowed.includes(e.toPort || 'in');
  });
}
export function forSave(nodes: unknown[]): unknown[] {
  const slim = (v: unknown) =>
    typeof v === 'string' && (v.startsWith('data:') || v.startsWith('blob:')) ? '' : v;
  return (nodes as Record<string, unknown>[]).map((n) => {
    const history = Array.isArray(n.history)
      ? (n.history as { value?: unknown }[]).slice(0, 8).map((h) => ({ ...h, value: slim(h?.value) }))
      : [];
    return { ...n, output: slim(n.output), history };
  });
}

export type BackfilledNode = {
  id: string;
  type: string;
  title: string;
  x: number;
  y: number;
  content: string;
  system: string;
  agent: Record<string, string>;
  image: { provider: string; model: string; aspect: string; seed: string; negative: string };
  video: { model: string; aspect: string; duration: number; seed: string; key: string };
  prov: { provider: string; model: string; key: string; customBase: string; models: string[]; search: string; loading: boolean };
  output: string;
  history: { value: string; at: number; model?: string }[];
  status: string;
  statusKind: '';
};

/** Fill fields added in later versions so old saves keep working. */
export function backfillNode(raw: unknown): BackfilledNode {
  const n = (raw || {}) as Record<string, unknown>;
  const str = (v: unknown, fb = '') => (typeof v === 'string' ? v : fb);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
  const agent = obj(n.agent);
  const agentOut: Record<string, string> = {};
  for (const [k, v] of Object.entries(agent)) if (typeof v === 'string') agentOut[k] = v;
  const hist = Array.isArray(n.history)
    ? (n.history as { value?: unknown; at?: unknown; model?: unknown }[])
        .filter((h) => h && typeof h.value === 'string')
        .slice(0, 8)
        .map((h) => ({
          value: h.value as string,
          at: typeof h.at === 'number' ? h.at : 0,
          ...(typeof h.model === 'string' ? { model: h.model } : {}),
        }))
    : [];

  return {
    id: str(n.id, `box_${Date.now().toString(36)}`),
    type: str(n.type, 'output'),
    title: str(n.title, 'Box'),
    x: Math.max(0, Math.round(num(n.x))),
    y: Math.max(0, Math.round(num(n.y))),
    content: str(n.content),
    system: str(n.system),
    agent: agentOut,
    image: { ...defaultImageOpts(), ...obj(n.image) } as BackfilledNode['image'],
    video: { model: 'seedance', aspect: 'landscape', duration: 4, seed: '', key: '', ...obj(n.video) },
    prov: {
      provider: 'openrouter', model: '', key: '', customBase: '',
      models: [], search: '', loading: false, ...obj(n.prov),
    } as BackfilledNode['prov'],
    output: '',
    history: hist,
    status: 'idle',
    statusKind: '',
  };
}
