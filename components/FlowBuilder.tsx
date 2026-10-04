'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  FREEONLY_LS,
  GKEY_LS,
  HFKEY_LS,
  KEY_LS,
  POLLEN_LS,
  MODEL_LS,
  PAID_MODELS,
  clearStaleLimits,
  coolingSummary,
  fetchFreeModels,
  isFreshlyLimited,
  isQuotaError,
  markModelLimited,
  shortLabel,
  splitKeys,
  tryKeys,
} from '@/lib/providers';
import { callOpenRouter, isLimitError, isNotFoundError } from '@/lib/openrouter';
import { AGENT_FIELDS, AGENT_SYSTEM, defaultAgentState } from '@/lib/agentPresets';
import { composeAgentDraft } from '@/lib/agentCompose';
import { IMAGE_ASPECTS, buildPollinationsUrl, defaultImageOpts, generateHFImage, generateNanoBanana, isImageValue, type ImageProvider } from '@/lib/imageGen';
import { VIDEO_DURATIONS, VIDEO_MODELS, buildVideoUrl, defaultVideoOpts, isVideoValue } from '@/lib/videoGen';
import { backendForProvider, imageModelsFor, isImageModel, type ImageBackend } from '@/lib/imageModels';
import { DEFAULT_MODEL, TEXT_PROVIDERS, fetchProviderModels, type TextProvider, PRESET_BASE_URLS } from '@/lib/providerCatalog';
import Link from 'next/link';
import ModelPicker from '@/components/ModelPicker';
import { CANVAS_LS, backfillNode, parseCanvas, sanitizeEdges, serializeCanvas } from '@/lib/canvas';
import { callCustomText, callGeminiText, callHFText, callPollinationsText } from '@/lib/textCallers';

type NodeType = 'input' | 'prompt' | 'ai' | 'agent' | 'image' | 'video' | 'provider' | 'code' | 'output';

const NODE_DEFS: Record<
  NodeType,
  { label: string; desc: string; hasIn: boolean; hasOut: boolean; default: string; systemDefault?: string }
> = {
  input: { label: 'Text Input', desc: 'Raw text source. No input port.', hasIn: false, hasOut: true, default: 'Hello world' },
  prompt: { label: 'Prompt', desc: 'Free template with {{input}} (no API cost).', hasIn: true, hasOut: true, default: 'Summarize this:\n{{input}}' },
  ai: { label: 'AI (OpenRouter)', desc: 'LLM call. Auto free model + fallback.', hasIn: true, hasOut: true, default: 'Answer about:\n{{input}}', systemDefault: 'You are a helpful assistant. Be concise.' },
  agent: { label: 'Agent: Image Prompt', desc: 'Preset chips + manual fields, AI-polished.', hasIn: true, hasOut: true, default: '' },
  image: { label: 'Generate Image', desc: 'prompt + extra ports → image.', hasIn: true, hasOut: true, default: '' },
  video: { label: 'Generate Video', desc: 'prompt + extra ports → video (key).', hasIn: true, hasOut: true, default: '' },
  provider: { label: 'Provider: LLM', desc: 'Config only: provider + model for wiring.', hasIn: false, hasOut: true, default: '' },
  code: { label: 'Code JS', desc: 'JS with `input`, must return a value.', hasIn: true, hasOut: true, default: '// `input` is upstream text\nreturn input.toUpperCase();' },
  output: { label: 'Output', desc: 'Displays final value. No output port.', hasIn: true, hasOut: false, default: '' },
};

type FlowNode = {
  id: string;
  type: NodeType;
  title: string;
  x: number;
  y: number;
  content: string;
  system: string;
  agent: Record<string, string>;
  image: { provider: ImageProvider; model: string; aspect: string; seed: string; negative: string };
  video: { model: string; aspect: string; duration: number; seed: string; key: string };
  prov: { provider: TextProvider; model: string; key: string; customBase: string; models: string[]; search: string; loading: boolean };
  output: string;
  history: { value: string; at: number; model?: string }[];
  status: string;
  statusKind: '' | 'ok' | 'err' | 'run';
  usedModel?: string;
};

type Edge = { id: string; from: string; to: string; toPort?: string };
type LogLine = { msg: string; cls: string };

const STARTER_TYPES: NodeType[] = ['provider', 'agent', 'image', 'video', 'output'];
const GALLERY_TYPES = (t: string) => t === 'output' || t === 'image' || t === 'video';
const ADVANCED_TYPES: NodeType[] = ['input', 'prompt', 'ai', 'code'];

function edgePath(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dy = Math.max(40, Math.abs(b.y - a.y) / 2);
  return `M ${a.x} ${a.y} C ${a.x} ${a.y + dy}, ${b.x} ${b.y - dy}, ${b.x} ${b.y}`;
}

export default function FlowBuilder() {
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 200, y: 80 });
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [gkey, setGkey] = useState('');
  const [hfkey, setHfkey] = useState('');
  const [pollen, setPollen] = useState('');
  const [model, setModel] = useState('');
  const [freeModels, setFreeModels] = useState<string[]>([]);
  const freeModelsRef = useRef(freeModels);
  freeModelsRef.current = freeModels;
  const [keyMsg, setKeyMsg] = useState('');
  const [keyMsgKind, setKeyMsgKind] = useState('');
  const [pollenMsg, setPollenMsg] = useState('');
  const [pollenMsgKind, setPollenMsgKind] = useState('');
  const [hfkeyMsg, setHfkeyMsg] = useState('');
  const [hfkeyMsgKind, setHfkeyMsgKind] = useState('');
  const [gkeyMsg, setGkeyMsg] = useState('');
  const [gkeyMsgKind, setGkeyMsgKind] = useState('');
  const [dragPath, setDragPath] = useState('');
  const [edgeDs, setEdgeDs] = useState<Record<string, string>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [freeOnly, setFreeOnly] = useState(false);
  const [cooling, setCooling] = useState('');
  const freeOnlyRef = useRef(false);
  freeOnlyRef.current = freeOnly;
  const refreshCooling = useCallback(() => {
    try { setCooling(coolingSummary()); } catch {}
  }, []);

  const viewportRef = useRef<HTMLDivElement>(null);
  const nodeEls = useRef(new Map<string, HTMLDivElement>());
  const seq = useRef(1);
  const pendingEdge = useRef<{ from: string } | null>(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const apiKeyRef = useRef(apiKey);
  apiKeyRef.current = apiKey;
  const gkeyRef = useRef(gkey);
  gkeyRef.current = gkey;
  const hfkeyRef = useRef(hfkey);
  hfkeyRef.current = hfkey;
  const pollenRef = useRef(pollen);
  pollenRef.current = pollen;

  const log = useCallback((msg: string, cls = 'info') => {
    setLogs((l) => [...l.slice(-200), { msg, cls }]);
  }, []);

  const uid = useCallback((prefix: string) => {
    return `${prefix}_${seq.current++}_${Date.now().toString(36)}`;
  }, []);

  const clientToWorld = useCallback(
    (cx: number, cy: number) => {
      const r = viewportRef.current?.getBoundingClientRect();
      if (!r) return { x: 0, y: 0 };
      return { x: (cx - r.left - pan.x) / scale, y: (cy - r.top - pan.y) / scale };
    },
    [pan, scale]
  );

  // ---- load saved key/model + live free catalog once ----
  useEffect(() => {
    try {
      clearStaleLimits();
      const k = localStorage.getItem(KEY_LS) || '';
      if (k) setApiKey(k);
      try {
        const g = localStorage.getItem(GKEY_LS) || '';
        if (g) setGkey(g);
      } catch {}
      try {
        const h = localStorage.getItem(HFKEY_LS) || '';
        if (h) setHfkey(h);
      } catch {}
      try {
        const pl = localStorage.getItem(POLLEN_LS) || '';
        if (pl) setPollen(pl);
      } catch {}
    } catch {}
    try {
      if (localStorage.getItem(FREEONLY_LS) === '1') {
        setFreeOnly(true);
        freeOnlyRef.current = true;
      }
    } catch {}
    fetchFreeModels().then((ids) => {
      setFreeModels(ids);
      try {
        const m = localStorage.getItem(MODEL_LS) || '';
        const paid = PAID_MODELS.some((x) => x.id === m);
        // must-choose: restore only valid picks; retired/paid-under-freeOnly resets to empty
        if (freeOnlyRef.current && paid) setModel('');
        else if (m && (paid || ids.includes(m))) setModel(m);
        // saved slug may be retired or unknown — start choosing fresh
        else setModel('');
      } catch {}
    });
    refreshCooling();
    const t = setInterval(refreshCooling, 60000);
    return () => clearInterval(t);
  }, [refreshCooling]);

    // ---- first run: guided template (or restore autosaved canvas) ----
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CANVAS_LS);
      const saved = raw ? parseCanvas(raw) : null;
      if (saved && saved.nodes.length) {
        const nodes = (saved.nodes as unknown[]).map(backfillNode) as FlowNode[];
        seq.current = 1000;
        setNodes(nodes);
        const clean = sanitizeEdges(nodes, saved.edges as { id: string; from: string; to: string; toPort?: string }[]);
        if (clean.length !== saved.edges.length) log(`Removed ${saved.edges.length - clean.length} stale wire(s).`, 'info');
        setEdges(clean as Edge[]);
        if (saved.model) setModel(saved.model);
        log('Restored autosaved canvas.', 'ok');
        setHydrated(true);
        return;
      }
    } catch {}
    spawnTemplate('image');
    log('Ready. Save your keys via API Keys…, then press Run.', 'info');
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- autosave canvas (not keys) ----
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(CANVAS_LS, serializeCanvas(nodes, edges, model));
      } catch {}
    }, 500);
    return () => clearTimeout(t);
  }, [nodes, edges, model, hydrated]);

  const exportCanvas = () => {
    try {
      const blob = new Blob([serializeCanvas(nodesRef.current, edgesRef.current, model)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'flowboxes-canvas.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      log('Canvas exported.', 'ok');
    } catch (err) {
      log(`Export failed: ${err instanceof Error ? err.message : err}`, 'err');
    }
  };

  const importCanvas = (file: File) => {
    file.text().then((raw) => {
      const saved = parseCanvas(raw);
      if (!saved || !saved.nodes.length) { log('Import failed: not a valid canvas file.', 'err'); return; }
      const nodes = (saved.nodes as unknown[]).map(backfillNode) as FlowNode[];
      seq.current = 1000 + nodes.length;
      nodeEls.current.clear();
      setSelectedEdge(null);
      setNodes(nodes);
      const clean = sanitizeEdges(nodes, saved.edges as { id: string; from: string; to: string; toPort?: string }[]);
      setEdges(clean as Edge[]);
      if (saved.model) setModel(saved.model);
      log(`Imported canvas: ${nodes.length} boxes.`, 'ok');
    }).catch(() => log('Import failed: could not read file.', 'err'));
  };

  const portCenter = useCallback((nodeId: string, which: string) => {
    const el = nodeEls.current.get(nodeId);
    const n = nodesRef.current.find((x) => x.id === nodeId);
    if (!el || !n) return { x: n?.x ?? 0, y: n?.y ?? 0 };
    if (which === 'out') return { x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight };
    // inputs live on the box sides: prompt/in on the left edge, provider/extra on the right
    const sideY = el.offsetTop + el.offsetHeight / 2;
    if (which === 'provider' || which === 'extra') return { x: el.offsetLeft + el.offsetWidth, y: sideY };
    return { x: el.offsetLeft, y: sideY };
  }, []);

  // recompute edge paths from measured DOM
  useLayoutEffect(() => {
    const ds: Record<string, string> = {};
    for (const e of edges) {
      ds[e.id] = edgePath(portCenter(e.from, 'out'), portCenter(e.to, e.toPort || 'in'));
    }
    setEdgeDs(ds);
  }, [nodes, edges, portCenter]);

  useEffect(() => {
    const onResize = () => {
      const ds: Record<string, string> = {};
      for (const e of edgesRef.current) {
        const get = (id: string, w: string) => {
          const el = nodeEls.current.get(id);
          const n = nodesRef.current.find((x) => x.id === id);
          if (!el || !n) return { x: 0, y: 0 };
          if (w === 'out') return { x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight };
          const sideY = el.offsetTop + el.offsetHeight / 2;
          if (w === 'provider' || w === 'extra') return { x: el.offsetLeft + el.offsetWidth, y: sideY };
          return { x: el.offsetLeft, y: sideY };
        };
        ds[e.id] = edgePath(get(e.from, 'out'), get(e.to, e.toPort || 'in'));
      }
      setEdgeDs(ds);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // non-passive wheel zoom
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setScale((s) => Math.min(1.8, Math.max(0.4, s * (e.deltaY < 0 ? 1.08 : 0.92))));
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, []);

  // delete selected edge
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedEdge) {
        setEdges((es) => es.filter((x) => x.id !== selectedEdge));
        setSelectedEdge(null);
      }
      if (e.key === 'Escape') setKeyOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedEdge]);

  const spawnNode = useCallback(
    (type: NodeType, x: number, y: number) => {
      const id = uid(type);
      const n: FlowNode = {
        id, type,
        title: `${NODE_DEFS[type].label} ${seq.current}`,
        x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)),
        content: NODE_DEFS[type].default,
        system: NODE_DEFS[type].systemDefault || '',
        agent: defaultAgentState(),
        image: defaultImageOpts(),
        video: defaultVideoOpts(),
        prov: { provider: 'openrouter', model: '', key: '', customBase: '', models: [], search: '', loading: false },
        output: '', history: [], status: 'idle', statusKind: '',
      };
      setNodes((ns) => [...ns, n]);
      log(`Spawned ${type}`, 'info');
    },
    [log, uid]
  );

  const paletteCard = (type: NodeType) => (
    <div
      key={type}
      className="palette-item"
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/x-node-type', type); e.dataTransfer.effectAllowed = 'copy'; }}
    >
      <div className="row">
        <strong>{NODE_DEFS[type].label}</strong>
        <button className="add" title="Add" onClick={() => {
          const r = viewportRef.current?.getBoundingClientRect();
          const c = clientToWorld(r ? r.left + r.width / 2 : 400, r ? r.top + r.height / 2 : 300);
          spawnNode(type, c.x - 130, c.y - 60);
        }}>+</button>
      </div>
      <small>{NODE_DEFS[type].desc}</small>
    </div>
  );

  const spawnTemplate = (kind: 'image' | 'chat') => {
    const r = viewportRef.current?.getBoundingClientRect();
    const c = clientToWorld(r ? r.left + r.width / 2 : 500, r ? r.top + r.height / 2 : 350);
    const mk = (type: NodeType, dx: number, dy: number, patch?: Partial<FlowNode>): FlowNode => ({
      id: uid(type), type,
      title: `${NODE_DEFS[type].label} ${seq.current}`,
      x: Math.max(0, Math.round(c.x + dx)), y: Math.max(0, Math.round(c.y + dy)),
      content: NODE_DEFS[type].default,
      system: NODE_DEFS[type].systemDefault || '',
      agent: defaultAgentState(),
      image: defaultImageOpts(),
      video: defaultVideoOpts(),
      prov: { provider: 'openrouter', model: '', key: '', customBase: '', models: [], search: '', loading: false },
      output: '', history: [], status: 'idle', statusKind: '',
      ...patch,
    });
    if (kind === 'chat') {
      const a = mk('input', -330, -30);
      const b = mk('ai', -30, -60);
      const o = mk('output', 300, -30);
      setNodes((ns) => [...ns, a, b, o]);
      setEdges((es) => [...es,
        { id: uid('e'), from: a.id, to: b.id, toPort: 'in' },
        { id: uid('e'), from: b.id, to: o.id, toPort: 'in' },
      ]);
      log('Spawned chat flow: Input → AI → Output', 'ok');
    } else {
      const inp = mk('input', -560, -40);
      const ag = mk('agent', -250, -140);
      const pv = mk('provider', -250, 250, { prov: { provider: 'openrouter', model: DEFAULT_MODEL.openrouter, key: '', customBase: '', models: [], search: '', loading: false } });
      const im = mk('image', 130, -40);
      const o = mk('output', 450, -20);
      setNodes((ns) => [...ns, inp, ag, pv, im, o]);
      setEdges((es) => [...es,
        { id: uid('e'), from: inp.id, to: ag.id, toPort: 'in' },
        { id: uid('e'), from: pv.id, to: ag.id, toPort: 'provider' },
        { id: uid('e'), from: ag.id, to: im.id, toPort: 'prompt' },
        { id: uid('e'), from: pv.id, to: im.id, toPort: 'provider' },
        { id: uid('e'), from: im.id, to: o.id, toPort: 'in' },
      ]);
      log('Spawned image flow: Input → Agent (+Provider) → Generate (+Provider) → Output', 'ok');
    }
  };

  const deleteNode = useCallback((id: string) => {
    setEdges((es) => es.filter((e) => e.from !== id && e.to !== id));
    nodeEls.current.delete(id);
    setNodes((ns) => ns.filter((n) => n.id !== id));
  }, []);

  const setAgentField = useCallback((id: string, key: string, value: string) => {
    setNodes((ns) => ns.map((x) => x.id === id
      ? { ...x, agent: { ...x.agent, [key]: value }, status: 'idle', statusKind: '' as const }
      : x));
  }, []);

  const togglePreset = useCallback((id: string, key: string, preset: string) => {
    setNodes((ns) => ns.map((x) => {
      if (x.id !== id) return x;
      const tokens = String(x.agent?.[key] || '').split(',').map((t) => t.trim()).filter(Boolean);
      const next = tokens.includes(preset) ? tokens.filter((t) => t !== preset) : [...tokens, preset];
      return { ...x, agent: { ...x.agent, [key]: next.join(', ') }, status: 'idle', statusKind: '' as const };
    }));
  }, []);

  // accordion: collapsed per node+field; subject open by default
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const isCollapsed = useCallback((nodeId: string, fieldKey: string) => {
    const k = `${nodeId}:${fieldKey}`;
    return collapsed[k] ?? (fieldKey !== 'subject');
  }, [collapsed]);
  const toggleSection = useCallback((nodeId: string, fieldKey: string) => {
    const k = `${nodeId}:${fieldKey}`;
    setCollapsed((c) => ({ ...c, [k]: !(c[k] ?? (fieldKey !== 'subject')) }));
  }, []);
  const setAllSections = useCallback((nodeId: string, open: boolean) => {
    setCollapsed((c) => {
      const next = { ...c };
      for (const f of AGENT_FIELDS) next[`${nodeId}:${f.key}`] = !open;
      return next;
    });
  }, []);

  const setImageOpt = useCallback((id: string, patch: Partial<FlowNode['image']>) => {    setNodes((ns) => ns.map((x) => x.id === id
      ? { ...x, image: { ...x.image, ...patch }, status: 'idle', statusKind: '' as const }
      : x));
  }, []);

  const setVideoOpt = useCallback((id: string, patch: Partial<FlowNode['video']>) => {
    setNodes((ns) => ns.map((x) => x.id === id
      ? { ...x, video: { ...x.video, ...patch }, status: 'idle', statusKind: '' as const }
      : x));
  }, []);

  /** Shared keys as a list (one per line in the menu). Box key, when set, wins alone. */
  const boxKeys = useCallback((boxKey: string, shared: string): string[] => {
    const b = (boxKey || '').trim();
    if (b) return splitKeys(b);
    return splitKeys(shared || '');
  }, []);

  const sharedKeysFor = useCallback((p: TextProvider): string[] => {
    if (p === 'openrouter') return splitKeys(apiKeyRef.current || '');
    if (p === 'gemini') return splitKeys(gkeyRef.current || '');
    if (p === 'huggingface') return splitKeys(hfkeyRef.current || '');
    return [];
  }, []);

  const setProv = useCallback((id: string, patch: Partial<FlowNode['prov']>) => {
    setNodes((ns) => ns.map((x) => x.id === id
      ? { ...x, prov: { ...x.prov, ...patch }, status: 'idle', statusKind: '' as const }
      : x));
  }, []);

  const testCustom = useCallback(async (id: string) => {
    const n = nodesRef.current.find((x) => x.id === id);
    if (!n || n.type !== 'provider' || n.prov.provider !== 'custom') return;
    setNodes((ns) => ns.map((x) => (x.id === id ? { ...x, status: 'testing…', statusKind: 'run' as const } : x)));
    try {
      const keys = (n.prov.key || '').trim() ? splitKeys(n.prov.key) : [];
      const r = await runProviderText(n.title, 'You are a helpful assistant.', 'Reply with the word OK.', 'custom', n.prov.model, keys, undefined, n.prov.customBase || '');
      setNodes((ns) => ns.map((x) => (x.id === id ? { ...x, status: `ok: ${r.out.slice(0, 80)}`, statusKind: 'ok' as const } : x)));
      log(`✓ ${n.title}: custom endpoint OK`, 'ok');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setNodes((ns) => ns.map((x) => (x.id === id ? { ...x, status: 'error: ' + msg, statusKind: 'err' as const } : x)));
      log(`✗ ${n.title}: test failed: ${msg}`, 'err');
    }
  }, [log]);

  const refreshModels = useCallback(async (id: string) => {
    const n = nodesRef.current.find((x) => x.id === id);
    if (!n || n.type !== 'provider') return;
    const p = n.prov.provider;
    if (p === 'custom') {
      log(`${n.title}: custom provider — type the model id manually, then Test.`, 'info');
      return;
    }
    const boxKey = (n.prov.key || '').trim();
    const listKey = p === 'openrouter' ? (apiKeyRef.current || '').trim()
      : p === 'gemini' ? (gkeyRef.current || '').trim()
      : p === 'huggingface' ? (hfkeyRef.current || '').trim() : '';
    setProv(id, { loading: true });
    try {
      const ids = await fetchProviderModels(p, boxKey || listKey);
      setNodes((ns) => ns.map((x) => {
        if (x.id !== id) return x;
        const keepModel = x.prov.model && ids.includes(x.prov.model) ? x.prov.model : (ids[0] || DEFAULT_MODEL[p]);
        return { ...x, prov: { ...x.prov, models: ids, model: keepModel, loading: false }, status: `${ids.length} models`, statusKind: '' as const };
      }));
      log(`${n.title}: loaded ${ids.length} ${p} models`, 'ok');
    } catch (err) {
      setProv(id, { loading: false });
      const msg = err instanceof Error ? err.message : String(err);
      log(`✗ ${n.title}: model list failed: ${msg}`, 'err');
    }
  }, [log, setProv]);

  const wouldCycle = useCallback(
    (fromId: string, toId: string) => {
      const adj = new Map<string, string[]>();
      for (const e of edgesRef.current) adj.set(e.from, [...(adj.get(e.from) || []), e.to]);
      const stack = [toId];
      const seen = new Set<string>();
      while (stack.length) {
        const cur = stack.pop()!;
        if (cur === fromId) return true;
        if (seen.has(cur)) continue;
        seen.add(cur);
        for (const nx of adj.get(cur) || []) stack.push(nx);
      }
      return false;
    },
    []
  );

  const finishEdge = useCallback(
    (toId: string, toPort: string = 'in') => {
      const p = pendingEdge.current;
      if (!p) return;
      const fromId = p.from;
      const target = nodesRef.current.find((n) => n.id === toId);
      const fromNode = nodesRef.current.find((n) => n.id === fromId);
      if (!target || !NODE_DEFS[target.type].hasIn) { log('Target has no input port.', 'err'); return; }
      const portOwner = target.type === 'image' ? ['prompt', 'provider']
        : target.type === 'video' ? ['prompt', 'extra']
        : target.type === 'agent' ? ['in', 'provider'] : ['in'];
      if (!portOwner.includes(toPort)) { log(`No '${toPort}' port on ${target.type} boxes.`, 'err'); return; }
      if (toPort === 'provider' && fromNode?.type !== 'provider') { log('Provider port accepts Provider boxes only.', 'err'); return; }
      if (toPort === 'prompt' && target.type === 'image' && fromNode?.type === 'provider') { log('Provider boxes feed the provider port, not prompt.', 'err'); return; }
      if (fromId === toId) { log('Cannot connect a box to itself.', 'err'); return; }
      if (edgesRef.current.some((e) => e.from === fromId && e.to === toId && (e.toPort || 'in') === toPort)) { log('Already connected.', 'err'); return; }
      if (wouldCycle(fromId, toId)) { log('Blocked: that would create a cycle.', 'err'); return; }
      const id = uid('e');
      setEdges((es) => [...es.filter((e) => !(e.to === toId && (e.toPort || 'in') === toPort)), { id, from: fromId, to: toId, toPort }]);
      // auto-sync: Generate adopts the first image model of the wired provider
      if (toPort === 'provider' && target.type === 'image' && fromNode?.type === 'provider') {
        const pp = fromNode.prov?.provider || 'openrouter';
        const first = imageModelsFor(pp)[0]?.id;
        if (first) {
          setNodes((ns) => ns.map((x) => (x.id === toId ? { ...x, image: { ...x.image, model: first }, status: 'idle', statusKind: '' as const } : x)));
          log(`Generate model auto-set to ${first} (${pp})`, 'info');
        }
      }
      log(`Connected ${fromNode?.title ?? fromId} → ${target.title} (${toPort})`, 'ok');
    },
    [log, uid, wouldCycle]
  );

  const startEdgeDrag = useCallback(
    (e: React.MouseEvent, fromId: string) => {
      e.preventDefault();
      e.stopPropagation();
      pendingEdge.current = { from: fromId };
      const move = (ev: MouseEvent) => {
        if (!pendingEdge.current) return;
        const r = viewportRef.current?.getBoundingClientRect();
        if (!r) return;
        const sc = Number(viewportRef.current?.dataset.scale || 1);
        void sc;
        const p = {
          x: (ev.clientX - r.left - panRef.current.x) / scaleRef.current,
          y: (ev.clientY - r.top - panRef.current.y) / scaleRef.current,
        };
        const el = nodeEls.current.get(fromId);
        const n = nodesRef.current.find((x) => x.id === fromId);
        const a = el && n
          ? { x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight }
          : { x: n?.x ?? 0, y: n?.y ?? 0 };
        setDragPath(edgePath(a, p));
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        pendingEdge.current = null;
        setDragPath('');
        document.querySelectorAll('.port.highlight').forEach((x) => x.classList.remove('highlight'));
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    []
  );
  const panRef = useRef(pan);
  panRef.current = pan;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const onHeaderDown = useCallback(
    (e: React.MouseEvent, id: string) => {
      if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('input')) return;
      e.preventDefault();
      const startX = e.clientX, startY = e.clientY;
      const orig = nodesRef.current.find((n) => n.id === id);
      if (!orig) return;
      const ox = orig.x, oy = orig.y;
      const move = (ev: MouseEvent) => {
        const nx = Math.max(0, Math.round(ox + (ev.clientX - startX) / scaleRef.current));
        const ny = Math.max(0, Math.round(oy + (ev.clientY - startY) / scaleRef.current));
        setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, x: nx, y: ny } : n)));
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    []
  );

  const onViewportDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.node')) return;
    const sx = e.clientX, sy = e.clientY;
    const ox = panRef.current.x, oy = panRef.current.y;
    viewportRef.current?.classList.add('panning');
    const move = (ev: MouseEvent) => setPan({ x: ox + (ev.clientX - sx), y: oy + (ev.clientY - sy) });
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      viewportRef.current?.classList.remove('panning');
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, []);

  function topoOrder(): string[] | null {
    const indeg: Record<string, number> = {};
    for (const n of nodes) indeg[n.id] = 0;
    const adj: Record<string, string[]> = {};
    for (const e of edges) {
      adj[e.from] = [...(adj[e.from] || []), e.to];
      indeg[e.to] = (indeg[e.to] || 0) + 1;
    }
    const q = nodes.map((n) => n.id).filter((id) => indeg[id] === 0);
    const order: string[] = [];
    while (q.length) {
      const cur = q.shift()!;
      order.push(cur);
      for (const nx of adj[cur] || []) {
        indeg[nx] -= 1;
        if (indeg[nx] === 0) q.push(nx);
      }
    }
    return order.length === nodes.length ? order : null;
  }

  async function runAIWithFallback(title: string, system: string, user: string, keys: string[], primary: string, signal?: AbortSignal) {
    if (!keys.length) throw new Error('Missing OpenRouter key.');
    const live = freeModelsRef.current;
    const chain = [primary, ...live.filter((m) => m !== primary)];
    // free-only mode: drop anything not in the live zero-price catalog
    const freeSet = new Set(live);
    const billable = freeOnlyRef.current ? chain.filter((m) => !freeSet.has(m)) : [];
    for (const b of billable) log(`${title}: skipping paid ${b} (free-only)`, 'info');
    const allowed = freeOnlyRef.current ? chain.filter((m) => freeSet.has(m)) : chain;
    if (!allowed.length) throw new Error('Free-only mode: no free models available.');
    // deprioritize models limited in the last 24h (quotas reset daily)
    const fresh = allowed.filter((m) => !isFreshlyLimited(m));
    const ordered = [...fresh, ...allowed.filter((m) => isFreshlyLimited(m))];
    let lastErr: unknown = null;
    for (const m of ordered) {
      try {
        const { value: out, keyIndex } = await tryKeys(keys, `${title} · ${m}`,
          (k) => callOpenRouter({ apiKey: k, model: m, system, user, signal }),
          (msg) => log(msg, 'info'));
        return { out, modelUsed: m, fellBack: m !== primary || keyIndex > 0 };
      } catch (err) {
        lastErr = err;
        if (isLimitError(err) || isNotFoundError(err)) {
          markModelLimited(m);
          const why = isNotFoundError(err) ? 'retired/unavailable' : 'limited (resets daily)';
          log(`${title}: ${m} ${why}, trying next…`, 'info');
          continue;
        }
        throw err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('All models unavailable.');
  }

  /** Shared text dispatch for Provider boxes and wired Agent polish. */
  async function runProviderText(title: string, system: string, user: string, provider: TextProvider, model: string, keys: string[], signal?: AbortSignal, customBase = '') {
    if (provider === 'openrouter') {
      const r = await runAIWithFallback(title, system, user, keys, model, signal);
      if (r.fellBack) log(`${title}: answered by fallback ${r.modelUsed}`, 'ok');
      return { out: r.out, used: r.modelUsed };
    } else if (provider === 'gemini') {
      if (!keys.length) throw new Error('Missing gemini key (box or shared).');
      const { value: out, keyIndex } = await tryKeys(keys, `${title} · ${model}`,
        (k) => callGeminiText({ prompt: user, system, key: k, model, signal }),
        (msg) => log(msg, 'info'));
      return { out, used: keyIndex > 0 ? `${model} (key #${keyIndex + 1})` : model };
    } else if (provider === 'pollinations') {
      const out = await callPollinationsText({ prompt: user, system, model, signal });
      return { out, used: `pollinations/${model}` };
    } else if (provider === 'custom') {
      if (!customBase.trim()) throw new Error('Custom provider needs a Base URL.');
      if (!model.trim()) throw new Error('Custom provider needs a model id.');
      const boxKeys = keys.length ? keys : [''];
      const { value: cout, keyIndex: cki } = await tryKeys(boxKeys, `${title} · custom/${model}`,
        (k) => callCustomText({ base: customBase, prompt: user, system, key: k, model, signal }),
        (msg) => log(msg, 'info'));
      return { out: cout, used: cki > 0 ? `${model} (key #${cki + 1})` : model };
    } else if (provider === 'hour' || provider === 'agnes') {
      if (!customBase.trim()) throw new Error(`${provider} provider needs a Base URL.`);
      if (!model.trim()) throw new Error(`${provider} provider needs a model id.`);
      const boxKeys = keys.length ? keys : [''];
      const { value: cout, keyIndex: cki } = await tryKeys(boxKeys, `${title} · ${provider}/${model}`,
        (k) => callCustomText({ base: customBase, prompt: user, system, key: k, model, signal }),
        (msg) => log(msg, 'info'));
      return { out: cout, used: cki > 0 ? `${model} (key #${cki + 1})` : model };
    }
    if (!keys.length) throw new Error('Missing huggingface key (box or shared).');
    const { value: out, keyIndex } = await tryKeys(keys, `${title} · ${model}`,
      (t) => callHFText({ prompt: user, system, model, token: t, signal }),
      (msg) => log(msg, 'info'));
    return { out, used: keyIndex > 0 ? `${model} (key #${keyIndex + 1})` : model };
  }

type ExecCtx = {
  id: string;
  inputVal: string;
  keys: string[];
  gkeys: string[];
  signal?: AbortSignal;
  inboundPort: Map<string, string>;
  outputs: Map<string, string>;
};

const pushHistory = (
  prev: { value: string; at: number; model?: string }[],
  out: string,
  used?: string
) => [{ value: out, at: Date.now(), ...(used ? { model: used } : {}) }, ...(prev || [])].slice(0, 8);

/** Execute one node. Used by Run-all and single-node Retry/Variation. */
async function execNodeBody(n: FlowNode, ctx: ExecCtx): Promise<{ out: string; used?: string }> {
  const { id, inputVal, keys, gkeys, signal, inboundPort, outputs } = ctx;
  if (n.type === 'input') return { out: n.content };
  if (n.type === 'prompt') {
    return { out: n.content.includes('{{input}}') ? n.content.split('{{input}}').join(inputVal) : inputVal ? n.content + '\n' + inputVal : n.content };
  }
  if (n.type === 'ai') {
    if (!model) throw new Error('Pick a global model first (topbar).');
    if (!keys.length) throw new Error('Missing OpenRouter key.');
    const user = n.content.includes('{{input}}')
      ? n.content.split('{{input}}').join(inputVal)
      : inputVal ? n.content + '\n' + inputVal : n.content;
    const r = await runAIWithFallback(n.title, n.system, user, keys, model, signal);
    if (r.fellBack) log(`${n.title}: answered by fallback ${r.modelUsed}`, 'ok');
    return { out: r.out, used: r.modelUsed };
  }
  if (n.type === 'agent') {
    const draft = composeAgentDraft(n.agent, inputVal);
    if (!draft.trim()) throw new Error('Agent has no fields filled.');
    const cfgFrom = inboundPort.get(`${id}:provider`);
    if (cfgFrom) {
      const pn = nodesRef.current.find((x) => x.id === cfgFrom);
      const pp = pn?.prov?.provider || 'openrouter';
      const pks = boxKeys(pn?.prov?.key || '', (sharedKeysFor(pp)[0] || ''));
      const pkeys = (pn?.prov?.key || '').trim() ? splitKeys(pn?.prov?.key || '') : sharedKeysFor(pp);
      if (pp !== 'pollinations' && !pkeys.length) throw new Error(`Missing ${pp} key (box or shared).`);
      const pm = pn?.prov?.model || '';
      if (!pm) throw new Error(`Pick a model in the wired Provider box (${pn?.title ?? 'provider'}) first.`);
      const r = await runProviderText(n.title, AGENT_SYSTEM, `Refine this into one image-generation prompt. Return only the final prompt:\n\n${draft}`, pp, pm, pkeys, signal, pn?.prov?.customBase || '');
      return { out: r.out, used: r.used + ` (via ${pn?.title ?? 'provider'})` };
    }
    if (!model) throw new Error('Pick a global model first (topbar).');
    if (!keys.length) throw new Error('Missing OpenRouter key.');
    const r = await runAIWithFallback(n.title, AGENT_SYSTEM, `Refine this into one image-generation prompt. Return only the final prompt:\n\n${draft}`, keys, model, signal);
    if (r.fellBack) log(`${n.title}: answered by fallback ${r.modelUsed}`, 'ok');
    return { out: r.out, used: r.modelUsed };
  }
  if (n.type === 'image') {
    const pFrom = inboundPort.get(`${id}:prompt`) ?? inboundPort.get(`${id}:in`);
    const prompt = (pFrom ? (outputs.get(pFrom) ?? '') : '').trim();
    if (!prompt) throw new Error('Image needs an upstream prompt (connect an Agent).');
    const aspect = n.image?.aspect || 'square';
    // heal stale picker value (e.g. provider swapped after wiring)
    let modelOverride: string | undefined;
    {
      const cfgFrom = inboundPort.get(`${id}:provider`);
      const pn = cfgFrom ? nodesRef.current.find((x) => x.id === cfgFrom) : undefined;
      const pp = pn?.prov?.provider;
      if (pp) {
        const list = imageModelsFor(pp);
        const cur = n.image?.model || '';
        if (list.length && (!cur || !list.some((m) => m.id === cur))) {
          modelOverride = list[0].id;
          setNodes((ns) => ns.map((x) => (x.id === id ? { ...x, image: { ...x.image, model: modelOverride as string }, status: 'idle', statusKind: '' as const } : x)));
          log(`${n.title}: auto-selected ${modelOverride} for ${pp}`, 'info');
        }
      }
    }
    const eff = resolveImage(n, inboundPort, modelOverride);
    if (eff.backend === 'pollinations') {
      return { out: buildPollinationsUrl(prompt, aspect, n.image?.seed || '', eff.model, n.image?.negative || ''), used: `pollinations/${eff.model}` };
    }
    if (!eff.keys.length) throw new Error(eff.backend === 'huggingface' ? 'Missing Hugging Face token.' : 'Missing Google AI Studio key.');
    if (eff.backend === 'huggingface') {
      const { value: out, keyIndex } = await tryKeys(eff.keys, `${n.title} · ${eff.model}`,
        (t) => generateHFImage(n.image?.negative ? `${prompt}\nAvoid: ${n.image.negative}` : prompt, t, signal), (msg) => log(msg, 'info'));
      return { out, used: keyIndex > 0 ? `${eff.model} (key #${keyIndex + 1})` : eff.model };
    }
    const { value: nout, keyIndex: nki } = await tryKeys(eff.keys, `${n.title} · ${eff.model}`,
      (k) => generateNanoBanana(n.image?.negative ? `${prompt}\nAvoid: ${n.image.negative}` : prompt, k, aspect, eff.model, signal), (msg) => log(msg, 'info'));
    return { out: nout, used: nki > 0 ? `${eff.model} (key #${nki + 1})` : eff.model };
  }
  if (n.type === 'video') {
    const pFrom = inboundPort.get(`${id}:prompt`) ?? inboundPort.get(`${id}:in`);
    const xFrom = inboundPort.get(`${id}:extra`);
    const prompt = (pFrom ? (outputs.get(pFrom) ?? '') : '').trim();
    const extra = (xFrom ? (outputs.get(xFrom) ?? '') : '').trim();
    const finalPrompt = [prompt, extra].filter(Boolean).join('\n').trim();
    if (!finalPrompt) throw new Error('Video needs an upstream prompt (connect text).');
    const v = n.video || defaultVideoOpts();
    const vkeys = (v.key || '').trim() ? splitKeys(v.key) : splitKeys(pollenRef.current || '');
    const k = vkeys[0] || '';
    if (!k) throw new Error('Video needs a Pollinations key (API Keys… → Pollinations).');
    const out = buildVideoUrl(finalPrompt, { model: v.model || 'seedance', aspect: v.aspect || 'landscape', duration: v.duration || 4, seed: v.seed || '', key: k });
    return { out, used: `pollinations/${v.model || 'seedance'}` };
  }
  if (n.type === 'provider') {
    throw new Error('Provider boxes supply config — wire one to an Agent/Generate provider port.');
  }
  if (n.type === 'code') {
    const fn = new Function('input', n.content);
    const r = fn(inputVal);
    return { out: r == null ? '' : typeof r === 'object' ? JSON.stringify(r, null, 2) : String(r) };
  }
  if (n.type === 'output') return { out: inputVal };
  throw new Error(`Unknown box type: ${n.type}`);
}

  /** Image backend comes ONLY from a wired Provider box. Throws otherwise. */
  const resolveImage = useCallback((img: FlowNode, inboundPort: Map<string, string>, modelOverride?: string): { backend: ImageBackend; model: string; keys: string[]; fromBox?: string } => {
    const cfgFrom = inboundPort.get(`${img.id}:provider`);
    if (!cfgFrom) throw new Error('Connect a Provider box to Generate (provider port).');
    const pn = nodesRef.current.find((x) => x.id === cfgFrom);
    const pp = pn?.prov?.provider || 'openrouter';
    const backend = backendForProvider(pp);
    if (!backend) throw new Error(`Provider box uses ${pp} (text-only) — switch it to Pollinations, Gemini or Hugging Face.`);
    const picked = modelOverride ?? img.image?.model ?? '';
    if (!picked || !isImageModel(pp, picked)) {
      const names = imageModelsFor(pp).map((m) => m.id).join(', ') || '(none)';
      throw new Error(`Pick an image model for ${pp}: ${names}.`);
    }
    const keys = (pn?.prov?.key || '').trim() ? splitKeys(pn?.prov?.key || '') : sharedKeysFor(pp);
    return { backend, model: picked, keys, fromBox: pn?.title };
  }, [sharedKeysFor]);

  async function runAll() {
    if (nodes.length === 0) { log('Nothing to run — spawn some boxes first.', 'err'); return; }
    const order = topoOrder();
    if (!order) { log('Cycle detected — remove a connection.', 'err'); return; }
    const keys = splitKeys(apiKey || '');
    const gkeys = splitKeys(gkey || '');
    const nodeTypeOf = (id: string) => nodes.find((n) => n.id === id)?.type;
    // per-port inbound: "nodeId:port" -> from-node id (legacy edges land on 'in')
    const inboundPort = new Map(edges.map((e) => [`${e.to}:${e.toPort || 'in'}`, e.from] as const));
    // provider boxes wired only into provider ports act as config, not executors
    const configSuppliers = new Set<string>();
    for (const n of nodes) {
      if (n.type !== 'provider') continue;
      const outEdges = edges.filter((e) => e.from === n.id);
      if (outEdges.length > 0 && outEdges.every((e) => (e.toPort || 'in') === 'provider')) configSuppliers.add(n.id);
    }
    // image backend resolves from the wired Provider box (see resolveImage)
    const needsAI = order.some((id) => { const t = nodeTypeOf(id); return t === 'ai' || t === 'agent'; });
    if (needsAI && !keys.length) {
      log('AI node needs an OpenRouter key — opening key menu…', 'err');
      setKeyOpen(true);
    }
    const needsImageKey = order.some((id) => {
      const n = nodes.find((x) => x.id === id);
      if (n?.type !== 'image') return false;
      try {
        const r = resolveImage(n, inboundPort);
        return r.backend !== 'pollinations' && !r.keys.length;
      }
      catch { return false; }
    });
    if (needsImageKey) {
      log('Image needs its provider key (Google/HF) — opening key menu…', 'err');
      setKeyOpen(true);
    }
    const needsPollen = order.some((id) => {
      const n = nodes.find((x) => x.id === id);
      if (n?.type !== 'video') return false;
      const k = (n.video?.key || '').trim() ? splitKeys(n.video?.key || '') : splitKeys(pollenRef.current || '');
      return !k.length;
    });
    if (needsPollen) {
      log('Video needs a Pollinations key — opening key menu…', 'err');
      setKeyOpen(true);
    }
    const inbound = new Map(edges.map((e) => [e.to, e.from] as const));
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    runningRef.current = true;
    log(`Running ${order.length} box(es)…`, 'info');
    const outputs = new Map<string, string>();
    const applyOk = (id: string, n: FlowNode, out: string, used?: string) => {
      outputs.set(id, out);
      setNodes((ns) => ns.map((x) => {
        if (x.id !== id) return x;
        const hist = GALLERY_TYPES(x.type) ? pushHistory(x.history || [], out, used) : x.history;
        return { ...x, output: out, history: hist, status: 'ok' + (used ? ` · ${used}` : ''), statusKind: 'ok' as const, usedModel: used };
      }));
      log(isImageValue(out) ? `✓ ${n.title}: [image ${out.length > 200 ? Math.round(out.length / 1024) + 'KB' : out.length + ' chars'}]` : `✓ ${n.title}: ${out.slice(0, 120)}${out.length > 120 ? '…' : ''}`, 'ok');
    };
    const applyErr = (id: string, n: FlowNode, msg: string, cancelled: boolean) => {
      outputs.set(id, '');
      setNodes((ns) => ns.map((x) => (x.id === id ? { ...x, output: '', status: cancelled ? 'cancelled' : 'error: ' + msg, statusKind: (cancelled ? '' : 'err') as FlowNode['statusKind'] } : x)));
      log(cancelled ? `○ ${n.title}: cancelled` : `✗ ${n.title}: ${msg}`, cancelled ? 'info' : 'err');
    };
    for (const id of order) {
      if (ctrl.signal.aborted) { log('Run cancelled.', 'info'); break; }
      const n = nodes.find((x) => x.id === id)!;
      const upId = inbound.get(id);
      const inputVal = upId ? (outputs.get(upId) ?? '') : '';
      if (n.type === 'provider') {
        outputs.set(id, '');
        const supplying = configSuppliers.has(id);
        setNodes((ns) => ns.map((x) => (x.id === id ? { ...x, status: supplying ? 'config →' : 'standby (not wired)', statusKind: '' as const } : x)));
        log(supplying ? `• ${n.title}: supplying provider config` : `• ${n.title}: standby — wire it to an Agent/Generate provider port`, 'info');
        continue;
      }
      setNodes((ns) => ns.map((x) => (x.id === id ? { ...x, status: 'running…', statusKind: 'run' as const } : x)));
      await new Promise((r) => setTimeout(r, 0));
      try {
        const { out, used } = await execNodeBody(n, { id, inputVal, keys, gkeys, signal: ctrl.signal, inboundPort, outputs });
        applyOk(id, n, out, used);
      } catch (err) {
        const cancelled = ctrl.signal.aborted;
        applyErr(id, n, err instanceof Error ? err.message : String(err), cancelled);
        if (cancelled) break;
      }
    }
    setRunning(false);
    runningRef.current = false;
    refreshCooling();
  }

  /** Re-run a single node from current canvas outputs (no full Run). */
  const rerunNode = useCallback(async (id: string) => {
    const n = nodesRef.current.find((x) => x.id === id);
    if (!n || runningRef.current) return;
    const edgesNow = edgesRef.current;
    const byId = new Map(nodesRef.current.map((x) => [x.id, x.output]));
    const legacy = edgesNow.find((e) => e.to === id && (e.toPort || 'in') === 'in')?.from;
    const inputVal = legacy ? (byId.get(legacy) ?? '') : '';
    const inboundPort = new Map(edgesNow.map((e) => [`${e.to}:${e.toPort || 'in'}`, e.from] as const));
    const outputs = new Map(nodesRef.current.map((x) => [x.id, x.output]));
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    runningRef.current = true;
    setNodes((ns) => ns.map((x) => (x.id === id ? { ...x, status: 'running…', statusKind: 'run' as const } : x)));
    try {
      const keys = splitKeys(apiKeyRef.current || '');
      const gkeys = splitKeys(gkeyRef.current || '');
      const { out, used } = await execNodeBody(n, { id, inputVal, keys, gkeys, signal: ctrl.signal, inboundPort, outputs });
      setNodes((ns) => ns.map((x) => {
        if (x.id !== id) return x;
        const hist = GALLERY_TYPES(x.type) ? pushHistory(x.history || [], out, used) : x.history;
        return { ...x, output: out, history: hist, status: 'ok' + (used ? ` · ${used}` : ''), statusKind: 'ok' as const, usedModel: used };
      }));
      log(isImageValue(out) ? `✓ ${n.title}: [image]` : `✓ ${n.title}: ${out.slice(0, 120)}${out.length > 120 ? '…' : ''}`, 'ok');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setNodes((ns) => ns.map((x) => (x.id === id ? { ...x, output: '', status: 'error: ' + msg, statusKind: 'err' as const } : x)));
      log(`✗ ${n.title}: ${msg}`, 'err');
    }
    setRunning(false);
    runningRef.current = false;
    refreshCooling();
  }, [log, refreshCooling]);

  /** Image variation: new random seed, re-run just this box. */
  const varyImage = useCallback((id: string) => {
    if (runningRef.current) return;
    const seed = String(Math.floor(Math.random() * 1000000));
    setNodes((ns) => ns.map((x) => (x.id === id ? { ...x, image: { ...x.image, seed }, status: 'idle', statusKind: '' as const } : x)));
    log(`🎲 Variation: seed ${seed} — re-running box…`, 'info');
    setTimeout(() => rerunNode(id), 60);
  }, [log, rerunNode]);

  const [compareIds, setCompareIds] = useState<string[]>([]);
  const toggleCompare = useCallback((id: string) => {
    setCompareIds((c) => c.includes(id) ? c.filter((x) => x !== id) : c.length >= 2 ? [c[1], id] : [...c, id]);
  }, []);
  const comparePair = compareIds
    .map((id) => nodes.find((n) => n.id === id))
    .filter((n): n is FlowNode => !!n && !!n.output);

  const copyOutput = useCallback(async (n: FlowNode) => {
    if (!n.output) return;
    try {
      await navigator.clipboard.writeText(n.output);
      log(`Copied ${n.title} (${n.output.length} chars).`, 'ok');
    } catch {
      log('Copy failed (clipboard blocked).', 'err');
    }
  }, [log]);

  const cancelRun = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const saveKey = () => {
    const v = apiKey.trim();
    if (!v) { setKeyMsg('Paste a key first.'); setKeyMsgKind('err'); return; }
    try {
      localStorage.setItem(KEY_LS, v);
    } catch { setKeyMsg('Could not save (storage blocked).'); setKeyMsgKind('err'); return; }
    const n = splitKeys(v).length;
    if (!splitKeys(v)[0].startsWith('sk-or-')) { setKeyMsg(`Warning: keys usually start with sk-or-… ${n} saved anyway.`); setKeyMsgKind('run'); }
    else { setKeyMsg(`${n} OpenRouter key(s) saved — fallback in order.`); setKeyMsgKind('ok'); }
    log(`OpenRouter key saved (${n}).`, 'ok');
  };
  const clearKey = () => {
    try { localStorage.removeItem(KEY_LS); } catch {}
    setApiKey('');
    setKeyMsg('Key cleared.');
    setKeyMsgKind('');
    log('OpenRouter key cleared.', 'info');
  };
  const saveGkey = () => {
    const v = gkey.trim();
    if (!v) { setGkeyMsg('Paste a key first.'); setGkeyMsgKind('err'); return; }
    try {
      localStorage.setItem(GKEY_LS, v);
    } catch { setGkeyMsg('Could not save (storage blocked).'); setGkeyMsgKind('err'); return; }
    setGkeyMsg(`Google key saved (${splitKeys(v).length}). Quota falls back in order.`);
    setGkeyMsgKind('ok');
    log(`Google key saved (${splitKeys(v).length}).`, 'ok');
  };
  const clearGkey = () => {
    try { localStorage.removeItem(GKEY_LS); } catch {}
    setGkey('');
    setGkeyMsg('Google key cleared.');
    setGkeyMsgKind('');
    log('Google key cleared.', 'info');
  };
  const hasKey = !!apiKey.trim();
  const hasGKey = !!gkey.trim();
  const hasHfkey = !!hfkey.trim();
  const hasPollen = !!pollen.trim();
  const savePollen = () => {
    const v = pollen.trim();
    if (!v) { setPollenMsg('Paste a key first.'); setPollenMsgKind('err'); return; }
    try {
      localStorage.setItem(POLLEN_LS, v);
    } catch { setPollenMsg('Could not save (storage blocked).'); setPollenMsgKind('err'); return; }
    setPollenMsg('Pollinations key saved. Free at enter.pollinations.ai.');
    setPollenMsgKind('ok');
    log('Pollinations key saved.', 'ok');
  };
  const clearPollen = () => {
    try { localStorage.removeItem(POLLEN_LS); } catch {}
    setPollen('');
    setPollenMsg('Pollinations key cleared.');
    setPollenMsgKind('');
    log('Pollinations key cleared.', 'info');
  };
  const saveHfkey = () => {
    const v = hfkey.trim();
    if (!v) { setHfkeyMsg('Paste a token first.'); setHfkeyMsgKind('err'); return; }
    try {
      localStorage.setItem(HFKEY_LS, v);
    } catch { setHfkeyMsg('Could not save (storage blocked).'); setHfkeyMsgKind('err'); return; }
    setHfkeyMsg(`HF token saved (${splitKeys(v).length}).`);
    setHfkeyMsgKind('ok');
    log(`HF token saved (${splitKeys(v).length}).`, 'ok');
  };
  const clearHfkey = () => {
    try { localStorage.removeItem(HFKEY_LS); } catch {}
    setHfkey('');
    setHfkeyMsg('HF token cleared.');
    setHfkeyMsgKind('');
    log('HF token cleared.', 'info');
  };

  return (
    <>
      <header className="topbar">
        <div className="brand">FlowBoxes</div>
        <div className="controls">
          <button id="runBtn" className="primary" onClick={runAll} disabled={running}>{running ? 'Running…' : 'Run'}</button>
          {running && <button onClick={cancelRun} className="danger-ghost">Cancel</button>}
          <button onClick={() => { setNodes((ns) => ns.map((n) => ({ ...n, output: '', history: [], status: 'idle', statusKind: '' as const, usedModel: undefined }))); log('Outputs cleared.', 'info'); }}>Clear outputs</button>
          <button className="danger-ghost" onClick={() => { setNodes([]); setEdges([]); setSelectedEdge(null); log('Canvas cleared.', 'info'); }}>Clear canvas</button>
          <div className="ai-settings">
            <span className={'key-status' + (hasKey ? ' saved' : '')} title={hasKey ? 'OpenRouter key saved in this browser' : 'No OpenRouter key — click API Keys…'}>
              {hasKey ? '● OR' : '○ OR'}
            </span>
            <span className={'key-status' + (hasGKey ? ' saved' : '')} title={hasGKey ? 'Google key saved in this browser' : 'No Google key — click API Keys… (needed for nano-banana)'}>
              {hasGKey ? '● G' : '○ G'}
            </span>
            <span className={'key-status' + (hasHfkey ? ' saved' : '')} title={hasHfkey ? 'HF token saved' : 'No HF token — click API Keys… (needed for Hugging Face)'}>
              {hasHfkey ? '● HF' : '○ HF'}
            </span>
            <span className={'key-status' + (hasPollen ? ' saved' : '')} title={hasPollen ? 'Pollinations key saved' : 'No Pollinations key — click API Keys… (needed for video)'}>
              {hasPollen ? '● P' : '○ P'}
            </span>
            <button onClick={() => setKeyOpen(true)} title="Set / save API keys">API Keys…</button>
            <Link href="/providers"><button title="Full provider directory">Providers…</button></Link>
            <div style={{display: 'flex', gap: 8, alignItems: 'center'}}>
              <Link href="/provider/openrouter"><button>OpenRouter</button></Link>
              <Link href="/provider/gemini"><button>Gemini</button></Link>
              <Link href="/provider/pollinations"><button>Pollinations</button></Link>
              <Link href="/provider/huggingface"><button>Hugging Face</button></Link>
              <Link href="/provider/magichour"><button>MagicHour</button></Link>
              <Link href="/provider/hour"><button>Hour</button></Link>
              <Link href="/provider/agnes"><button>Agnes AI</button></Link>
              <Link href="/provider/custom"><button>Custom</button></Link>
            </div>
            <ModelPicker
              value={model}
              title="Primary model (live free list, auto-fallback)"
              placeholder="— choose a model…"
              groups={[
                { label: 'Free (live, resets daily)', options: freeModels.map((id) => ({ id, label: shortLabel(id) })) },
                ...(!freeOnly ? [{ label: 'Paid', options: PAID_MODELS.map((m) => ({ id: m.id, label: m.label })) }] : []),
              ]}
              onChange={(id) => { setModel(id); try { if (id) localStorage.setItem(MODEL_LS, id); else localStorage.removeItem(MODEL_LS); } catch {} }}
            />
            <label className="free-toggle" title="Block paid models everywhere">
              <input type="checkbox" checked={freeOnly} onChange={(e) => {
                const v = e.target.checked;
                setFreeOnly(v);
                try { localStorage.setItem(FREEONLY_LS, v ? '1' : '0'); } catch {}
                if (v && PAID_MODELS.some((x) => x.id === model)) {
                  setModel('');
                  try { localStorage.removeItem(MODEL_LS); } catch {}
                }
                log(v ? 'Free-only mode on: paid models blocked.' : 'Free-only mode off.', 'info');
              }} /> Free only
            </label>
            {cooling && <span className="muted" title="Models resting until daily reset">🧊 {cooling}</span>}
          </div>
          <span className="hint">Drag boxes in • drag from <span className="dot out" /> to <span className="dot in" /> to connect</span>
        </div>
        <div className="zoom-controls">
          <button onClick={() => setScale((s) => Math.max(0.4, s / 1.15))}>−</button>
          <span>{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale((s) => Math.min(1.8, s * 1.15))}>+</button>
          <button onClick={() => { setScale(1); setPan({ x: 200, y: 80 }); }}>Reset view</button>
        </div>
      </header>

      <div className="layout">
        <aside className="palette">
          <h3>Start here</h3>
          <div className="template-row">
            <button title="Spawn Input → Agent → Generate + Provider → Output, pre-connected" onClick={() => spawnTemplate('image')}>🖼 Image flow</button>
            <button title="Spawn Input → AI → Output, pre-connected" onClick={() => spawnTemplate('chat')}>💬 Chat flow</button>
          </div>
          <div>
            {STARTER_TYPES.map((type) => paletteCard(type))}
          </div>
          <button className="adv-toggle" onClick={() => setShowAdvanced((s) => !s)}>
            {showAdvanced ? '▾ Advanced' : '▸ Advanced (prompt, code, AI…)'}
          </button>
          {showAdvanced && (
            <div>{ADVANCED_TYPES.map((type) => paletteCard(type))}</div>
          )}
          <div className="template-row">
            <button title="Download canvas as JSON" onClick={exportCanvas}>⬇ Export</button>
            <label className="import-label" title="Load canvas from JSON file">
              ⬆ Import
              <input type="file" accept="application/json,.json" hidden onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importCanvas(f);
                e.target.value = '';
              }} />
            </label>
          </div>
          <div className="help">
            <h4>How it works</h4>
            <ol>
              <li>Click <b>🖼 Image flow</b> for the guided setup</li>
              <li>Agent takes <b>in</b> (text) + <b>provider</b> (Provider box)</li>
              <li>Generate takes <b>prompt</b> (Agent) + <b>provider</b> (Provider box)</li>
              <li>Save keys via <b>API Keys…</b>, press <b>Run</b></li>
            </ol>
            <p className="muted">Click an edge to select, Delete to remove. Right-click edge to delete.</p>
          </div>
        </aside>

        <main className="canvas-wrap">
          <div
            id="viewport"
            ref={viewportRef}
            onMouseDown={onViewportDown}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const type = e.dataTransfer.getData('text/x-node-type') as NodeType;
              if (!type || !NODE_DEFS[type]) return;
              const p = clientToWorld(e.clientX, e.clientY);
              spawnNode(type, p.x - 130, p.y - 40);
            }}
          >
            <div id="world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}>
              <div id="grid" />
              <svg id="edges" viewBox="0 0 4000 3000">
                {edges.map((e) => (
                  <path
                    key={e.id}
                    d={edgeDs[e.id] || ''}
                    className={'edge' + (e.id === selectedEdge ? ' selected' : '') + ((e.toPort || 'in') === 'provider' ? ' edge-provider' : '')}
                    onMouseDown={(ev) => { ev.stopPropagation(); setSelectedEdge(e.id); }}
                    onContextMenu={(ev) => { ev.preventDefault(); setEdges((es) => es.filter((x) => x.id !== e.id)); setSelectedEdge(null); }}
                  />
                ))}
              </svg>
              <div id="nodes">
                {nodes.map((n) => (
                  <div
                    key={n.id}
                    ref={(el) => { if (el) nodeEls.current.set(n.id, el); }}
                    className={'node' + (n.id === selectedNode ? ' selected-node' : '')}
                    style={{ left: n.x, top: n.y }}
                    onMouseDown={() => { setSelectedNode(n.id); }}
                  >
                    {NODE_DEFS[n.type].hasIn && (n.type === 'image' ? (
                      <>
                        <div
                          className="port in side-l"
                          title="Prompt: drop Agent/text here"
                          onMouseUp={() => finishEdge(n.id, 'prompt')}
                          onMouseEnter={(e) => { if (pendingEdge.current) (e.target as HTMLElement).classList.add('highlight'); }}
                          onMouseLeave={(e) => (e.target as HTMLElement).classList.remove('highlight')}
                        ><span className="port-label">prompt</span></div>
                        <div
                          className="port in side-r"
                          title="Provider: drop a Provider box here"
                          onMouseUp={() => finishEdge(n.id, 'provider')}
                          onMouseEnter={(e) => { if (pendingEdge.current) (e.target as HTMLElement).classList.add('highlight'); }}
                          onMouseLeave={(e) => (e.target as HTMLElement).classList.remove('highlight')}
                        ><span className="port-label">provider</span></div>
                      </>
                    ) : n.type === 'video' ? (
                      <>
                        <div
                          className="port in side-l"
                          title="Prompt: drop text here"
                          onMouseUp={() => finishEdge(n.id, 'prompt')}
                          onMouseEnter={(e) => { if (pendingEdge.current) (e.target as HTMLElement).classList.add('highlight'); }}
                          onMouseLeave={(e) => (e.target as HTMLElement).classList.remove('highlight')}
                        ><span className="port-label">prompt</span></div>
                        <div
                          className="port in side-r"
                          title="Extra: drop a text box here (appended)"
                          onMouseUp={() => finishEdge(n.id, 'extra')}
                          onMouseEnter={(e) => { if (pendingEdge.current) (e.target as HTMLElement).classList.add('highlight'); }}
                          onMouseLeave={(e) => (e.target as HTMLElement).classList.remove('highlight')}
                        ><span className="port-label">extra</span></div>
                      </>
                    ) : n.type === 'agent' ? (
                      <>
                        <div
                          className="port in side-l"
                          title="Text: drop Input here"
                          onMouseUp={() => finishEdge(n.id, 'in')}
                          onMouseEnter={(e) => { if (pendingEdge.current) (e.target as HTMLElement).classList.add('highlight'); }}
                          onMouseLeave={(e) => (e.target as HTMLElement).classList.remove('highlight')}
                        ><span className="port-label">in</span></div>
                        <div
                          className="port in side-r"
                          title="Provider: drop a Provider box here"
                          onMouseUp={() => finishEdge(n.id, 'provider')}
                          onMouseEnter={(e) => { if (pendingEdge.current) (e.target as HTMLElement).classList.add('highlight'); }}
                          onMouseLeave={(e) => (e.target as HTMLElement).classList.remove('highlight')}
                        ><span className="port-label">provider</span></div>
                      </>
                    ) : (
                      <div
                        className="port in side-l"
                        title="Input: drop a connection here"
                        onMouseUp={() => finishEdge(n.id, 'in')}
                        onMouseEnter={(e) => { if (pendingEdge.current) (e.target as HTMLElement).classList.add('highlight'); }}
                        onMouseLeave={(e) => (e.target as HTMLElement).classList.remove('highlight')}
                      ><span className="port-label">in</span></div>
                    ))}
                    <div className="node-header" onMouseDown={(e) => onHeaderDown(e, n.id)}>
                      <span className={`node-type type-${n.type}`}>{n.type}</span>
                      <input className="node-title" value={n.title} spellCheck={false} onChange={(e) => setNodes((ns) => ns.map((x) => x.id === n.id ? { ...x, title: e.target.value } : x))} />
                      <button className="node-del" title="Delete node" onClick={() => deleteNode(n.id)}>×</button>
                    </div>
                    <div className="node-body">
                      {n.type === 'ai' ? (
                        <>
                          <div className="field-label">System prompt</div>
                          <textarea className="small" value={n.system} spellCheck={false} placeholder="You are a helpful assistant…"
                            onMouseDown={(e) => e.stopPropagation()}
                            onChange={(e) => setNodes((ns) => ns.map((x) => x.id === n.id ? { ...x, system: e.target.value, status: 'idle', statusKind: '' as const } : x))} />
                          <div className="field-label">User template (use {'{{input}}'})</div>
                          <textarea value={n.content} spellCheck={false}
                            onMouseDown={(e) => e.stopPropagation()}
                            onChange={(e) => setNodes((ns) => ns.map((x) => x.id === n.id ? { ...x, content: e.target.value, status: 'idle', statusKind: '' as const } : x))} />
                        </>
                      ) : n.type === 'agent' ? (
                        <>
                          {!edges.some((e) => e.to === n.id && (e.toPort || 'in') === 'provider') && (
                            <div className="muted">Polish uses the global model — or wire a Provider box to provider.</div>
                          )}
                          <div className="modal-row agent-collapse-row">
                            <button onClick={() => setAllSections(n.id, true)}>Expand all</button>
                            <button onClick={() => setAllSections(n.id, false)}>Collapse all</button>
                          </div>
                          {AGENT_FIELDS.map((f) => {
                            const val = n.agent?.[f.key] || '';
                            const tokens = val.split(',').map((t) => t.trim()).filter(Boolean);
                            const shut = isCollapsed(n.id, f.key);
                            const summary = val.trim() ? val.trim().slice(0, 42) + (val.trim().length > 42 ? '…' : '') : '—';
                            return (
                              <div key={f.key} className="acc-section">
                                <button className="acc-header"
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={() => toggleSection(n.id, f.key)}>
                                  <span className="acc-title">{f.label}</span>
                                  <span className="acc-summary">{summary}</span>
                                  <span className="acc-chev">{shut ? '▸' : '▾'}</span>
                                </button>
                                {!shut && (
                                  <div className="acc-body">
                                    {f.presets.length > 0 && (
                                      <div className="chips">
                                        {f.presets.map((p) => (
                                          <button key={p} className={'chip' + (tokens.includes(p) ? ' active' : '')}
                                            onMouseDown={(e) => e.stopPropagation()}
                                            onClick={() => togglePreset(n.id, f.key, p)}>{p}</button>
                                        ))}
                                      </div>
                                    )}
                                    {f.textarea ? (
                                      <textarea className="small" value={val} placeholder={f.placeholder} spellCheck={false}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onChange={(e) => setAgentField(n.id, f.key, e.target.value)} />
                                    ) : (
                                      <input className="field-input" value={val} placeholder={f.placeholder} spellCheck={false}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onChange={(e) => setAgentField(n.id, f.key, e.target.value)} />
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </>
                      ) : n.type === 'image' ? (
                        <>
                          {(() => {
                            const wFrom = edges.find((e) => e.to === n.id && (e.toPort || 'in') === 'provider')?.from;
                            const wNode = wFrom ? nodes.find((x) => x.id === wFrom) : undefined;
                            const wProv = wNode?.prov?.provider;
                            const models = wProv ? imageModelsFor(wProv) : [];
                            return (
                              <>
                                <div className="field-label">Provider (from wired box)</div>
                                <div className="muted">{wNode ? `${wNode.title} → ${wProv}` : '⚠ wire a Provider box to the provider port'}</div>
                                <div className="field-label">Image model</div>
                                <select className="field-input" value={n.image?.model || ''}
                                  disabled={!models.length}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onChange={(e) => setImageOpt(n.id, { model: e.target.value })}>
                                  {!models.length && <option value="">wire a provider first</option>}
                                  {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                                </select>
                              </>
                            );
                          })()}
                          <div className="field-label">Aspect</div>
                          <select className="field-input" value={n.image?.aspect || 'square'}
                            onMouseDown={(e) => e.stopPropagation()}
                            onChange={(e) => setImageOpt(n.id, { aspect: e.target.value })}>
                            {IMAGE_ASPECTS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                          </select>
                          <div className="field-label">Seed (blank = random, Pollinations)</div>
                          <input className="field-input" value={n.image?.seed || ''} placeholder="e.g. 42" spellCheck={false}
                            onMouseDown={(e) => e.stopPropagation()}
                            onChange={(e) => setImageOpt(n.id, { seed: e.target.value })} />
                          <div className="field-label">Negative prompt</div>
                          <input className="field-input" value={n.image?.negative || ''} placeholder="blurry, watermark, low quality…" spellCheck={false}
                            onMouseDown={(e) => e.stopPropagation()}
                            onChange={(e) => setImageOpt(n.id, { negative: e.target.value })} />
                          <div className="field-label">Negative prompt</div>
                          <input className="field-input" value={n.image?.negative || ''} placeholder="blurry, watermark, low quality…" spellCheck={false}
                            onMouseDown={(e) => e.stopPropagation()}
                            onChange={(e) => setImageOpt(n.id, { negative: e.target.value })} />
                          <div className="muted">Prompt comes from the <b>prompt</b> port (Agent).</div>
                        </>
                      ) : n.type === 'video' ? (
                        <>
                          <div className="field-label">Model (Pollen-metered)</div>
                          <select className="field-input" value={n.video?.model || 'seedance'}
                            onMouseDown={(e) => e.stopPropagation()}
                            onChange={(e) => setVideoOpt(n.id, { model: e.target.value })}>
                            {VIDEO_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                          </select>
                          <div className="field-label">Duration (s)</div>
                          <select className="field-input" value={n.video?.duration || 4}
                            onMouseDown={(e) => e.stopPropagation()}
                            onChange={(e) => setVideoOpt(n.id, { duration: Number(e.target.value) })}>
                            {VIDEO_DURATIONS.map((d) => <option key={d} value={d}>{d}s</option>)}
                          </select>
                          <div className="field-label">Aspect</div>
                          <select className="field-input" value={n.video?.aspect || 'landscape'}
                            onMouseDown={(e) => e.stopPropagation()}
                            onChange={(e) => setVideoOpt(n.id, { aspect: e.target.value })}>
                            <option value="square">Square 1:1</option>
                            <option value="portrait">Portrait 9:16</option>
                            <option value="landscape">Landscape 16:9</option>
                          </select>
                          <div className="field-label">Seed (blank = random)</div>
                          <input className="field-input" value={n.video?.seed || ''} placeholder="e.g. 7" spellCheck={false}
                            onMouseDown={(e) => e.stopPropagation()}
                            onChange={(e) => setVideoOpt(n.id, { seed: e.target.value })} />
                          <div className="field-label">Key override (blank = shared)</div>
                          <input className="field-input" type="password" value={n.video?.key || ''} placeholder="shared Pollinations key"
                            autoComplete="off" spellCheck={false}
                            onMouseDown={(e) => e.stopPropagation()}
                            onChange={(e) => setVideoOpt(n.id, { key: e.target.value })} />
                          <div className="muted">Prompt = upstream <b>prompt</b> + <b>extra</b> merged.</div>
                        </>
                      ) : n.type === 'provider' ? (
                        <>
                          <div className="field-label">Provider</div>
                          <select className="field-input" value={n.prov?.provider || 'openrouter'}
                            onMouseDown={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const p = e.target.value as TextProvider;
                              setProv(n.id, { provider: p, model: DEFAULT_MODEL[p], models: [], search: '' });
                            }}>
                            {TEXT_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                          </select>
                          <div className="field-label">Key (blank = shared)</div>
                          <input className="field-input" type="password" value={n.prov?.key || ''} placeholder={n.prov?.provider === 'custom' ? 'optional key' : 'shared key'}
                            autoComplete="off" spellCheck={false}
                            onMouseDown={(e) => e.stopPropagation()}
                            onChange={(e) => setProv(n.id, { key: e.target.value })} />
                          {['custom', 'hour', 'agnes'].includes(n.prov?.provider ?? '') ? (
                            <>
                              <div className="field-label">Base URL</div>
                              <input className="field-input" value={n.prov?.customBase || PRESET_BASE_URLS[n.prov?.provider as TextProvider] || ''} placeholder="https://host/v1"
                                autoComplete="off" spellCheck={false}
                                onMouseDown={(e) => e.stopPropagation()}
                                onChange={(e) => setProv(n.id, { customBase: e.target.value })} />
                              <div className="field-label">Model id (manual)</div>
                              <input className="field-input" value={n.prov?.model || ''} placeholder="e.g. mystuff-1.0-free"
                                autoComplete="off" spellCheck={false}
                                onMouseDown={(e) => e.stopPropagation()}
                                onChange={(e) => setProv(n.id, { model: e.target.value })} />
                              <div className="modal-row agent-collapse-row">
                                <button onClick={() => testCustom(n.id)}>Test endpoint</button>
                              </div>
                            </>
                          ) : (
                            <>
                          <div className="field-label">Model (live lookup)</div>
                          <ModelPicker
                            value={n.prov?.model || ''}
                            placeholder="press Refresh, then pick…"
                            title="Model from live provider catalog"
                            groups={[{
                              label: `${n.prov?.provider || 'openrouter'} · ${(n.prov?.models || []).length} loaded`,
                              options: (n.prov?.models || [])
                                .filter((id) => !freeOnly || n.prov?.provider !== 'openrouter' || freeModels.includes(id))
                                .map((id) => ({ id, label: id })),
                            }]}
                            onChange={(id) => setProv(n.id, { model: id })}
                          />
                          <div className="modal-row agent-collapse-row">
                            <button onClick={() => refreshModels(n.id)} disabled={!!n.prov?.loading}
                              onMouseDown={(e) => e.stopPropagation()}>
                              {n.prov?.loading ? 'loading…' : 'Refresh models'}
                            </button>
                          </div>
                          <div className="muted">Config only — wire this box to an Agent/Generate provider port.</div>
                            </>
                          )}
                        </>
                      ) : n.type !== 'output' ? (
                        <textarea className={n.type === 'input' ? 'small' : ''} value={n.content} spellCheck={false}
                          onMouseDown={(e) => e.stopPropagation()}
                          onChange={(e) => setNodes((ns) => ns.map((x) => x.id === n.id ? { ...x, content: e.target.value, status: 'idle', statusKind: '' as const } : x))} />
                      ) : (
                        <div className="muted">Shows the upstream result after Run.</div>
                      )}
                      <div className="output-preview">
                        {n.output === '' ? '— no output yet —' : isVideoValue(n.output) ? (
                          <>
                            <video className="preview-img" src={n.output} controls preload="metadata" />
                            <div className="muted img-url">{n.output.slice(0, 200)}</div>
                          </>
                        ) : isImageValue(n.output) ? (
                          <>
                            <img className="preview-img" src={n.output} alt="generated" />
                            <div className="muted img-url">{n.output.startsWith('data:') ? `[embedded image ${Math.round(n.output.length / 1024)}KB]` : n.output.slice(0, 200)}</div>
                          </>
                        ) : n.output.slice(0, 2000)}
                      </div>
                      {n.usedModel && <div className="used-model">via {n.usedModel}</div>}
                      <div className="node-actions">
                        <button title="Re-run just this box" disabled={running} onClick={() => rerunNode(n.id)}>↻ Retry</button>
                        {n.type === 'image' && <button title="New random seed + re-run" disabled={running} onClick={() => varyImage(n.id)}>🎲 Variation</button>}
                        {n.output && <button title="Copy output" onClick={() => copyOutput(n)}>📋 Copy</button>}
                        {n.output && <button title="Mark for compare" className={compareIds.includes(n.id) ? 'primary' : ''} onClick={() => toggleCompare(n.id)}>⚖ Compare</button>}
                      </div>
                      {(GALLERY_TYPES(n.type)) && (n.history || []).length > 1 && (
                        <div className="gallery">
                          {(n.history || []).map((h, i) => (
                            <button key={`${h.at}-${i}`} className={'g-item' + (h.value === n.output ? ' current' : '')}
                              title={h.model ? `${new Date(h.at).toLocaleTimeString()} · ${h.model}` : new Date(h.at).toLocaleTimeString()}
                              onClick={() => setNodes((ns) => ns.map((x) => x.id === n.id ? { ...x, output: h.value, usedModel: h.model } : x))}>
                              {isVideoValue(h.value) ? (
                                <span>🎬 video</span>
                              ) : isImageValue(h.value) && h.value ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={h.value} alt="" />
                              ) : (
                                <span>{(h.value || '(empty)').slice(0, 60)}</span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className={'status' + (n.statusKind === 'ok' ? ' ok' : n.statusKind === 'err' ? ' err' : n.statusKind === 'run' ? ' run' : '')}>
                        {n.status || 'idle'}
                      </div>
                    </div>
                    {NODE_DEFS[n.type].hasOut && (
                      <div className="port out" title="Output: drag to connect" onMouseDown={(e) => startEdgeDrag(e, n.id)}>
                        <span className="port-out-label">out</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <svg id="dragEdgeLayer"><path id="dragEdge" className={'drag-edge' + (dragPath ? '' : ' hidden')} d={dragPath} /></svg>
            </div>
          </div>
          {comparePair.length >= 2 && (
            <div className="compare-tray">
              {comparePair.map((n) => (
                <div key={n.id} className="compare-cell">
                  <div className="muted">{n.title}</div>
                  {isVideoValue(n.output) ? (
                    <video className="preview-img" src={n.output} controls preload="metadata" />
                  ) : isImageValue(n.output) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="preview-img" src={n.output} alt="" />
                  ) : (
                    <div className="output-preview">{n.output.slice(0, 2000)}</div>
                  )}
                </div>
              ))}
              <button className="danger-ghost" onClick={() => setCompareIds([])}>✕</button>
            </div>
          )}
          <div className="log" ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>
            {logs.map((l, i) => <div key={i} className={l.cls}>{l.msg}</div>)}
          </div>
        </main>
      </div>

      {keyOpen && (
        <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget) setKeyOpen(false); }}>
          <div className="modal-card">
            <h3>OpenRouter API Key</h3>
            <p className="muted">Saved in this browser (localStorage). Get one at openrouter.ai/keys. Free <code>:free</code> models still need a key but burn no credits; quotas reset daily.</p>
            <textarea rows={3} placeholder={'sk-or-... (one per line = fallback keys)'} autoComplete="off" spellCheck={false} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            <div className="modal-row">
              <button className="primary" onClick={saveKey}>Save</button>
              <button className="danger-ghost" onClick={clearKey}>Clear</button>
              <button onClick={() => setKeyOpen(false)}>Close</button>
            </div>
            {keyMsg && <div className={'status ' + keyMsgKind}>{keyMsg}</div>}
            <h3>Google AI Studio Key</h3>
            <p className="muted">Only needed for nano-banana image boxes. Get one at aistudio.google.com/apikey.</p>
            <textarea rows={3} placeholder={'AIza... (one per line = fallback keys)'} autoComplete="off" spellCheck={false} value={gkey} onChange={(e) => setGkey(e.target.value)} />
            <div className="modal-row">
              <button className="primary" onClick={saveGkey}>Save</button>
              <button className="danger-ghost" onClick={clearGkey}>Clear</button>
            </div>
            {gkeyMsg && <div className={'status ' + gkeyMsgKind}>{gkeyMsg}</div>}
            <h3>Hugging Face Token</h3>
            <p className="muted">Only needed for Hugging Face provider boxes. Free at huggingface.co/settings/tokens.</p>
            <textarea rows={3} placeholder={'hf_... (one per line = fallback keys)'} autoComplete="off" spellCheck={false} value={hfkey} onChange={(e) => setHfkey(e.target.value)} />
            <div className="modal-row">
              <button className="primary" onClick={saveHfkey}>Save</button>
              <button className="danger-ghost" onClick={clearHfkey}>Clear</button>
            </div>
            {hfkeyMsg && <div className={'status ' + hfkeyMsgKind}>{hfkeyMsg}</div>}
            <h3>Pollinations Key</h3>
            <p className="muted">Needed for video boxes (veo/seedance are Pollen-metered). Free tier at enter.pollinations.ai.</p>
            <textarea rows={2} placeholder={'pk_... / sk_... (one per line)'} autoComplete="off" spellCheck={false} value={pollen} onChange={(e) => setPollen(e.target.value)} />
            <div className="modal-row">
              <button className="primary" onClick={savePollen}>Save</button>
              <button className="danger-ghost" onClick={clearPollen}>Clear</button>
            </div>
            {pollenMsg && <div className={'status ' + pollenMsgKind}>{pollenMsg}</div>}
          </div>
        </div>
      )}
    </>
  );
}
