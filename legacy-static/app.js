// FlowBoxes - minimal drag & drop dataflow builder
const NODE_DEFS = {
  input: { label: 'Text Input', desc: 'Raw text source. No input port.', hasIn: false, hasOut: true, default: 'Hello world' },
  prompt: { label: 'Prompt', desc: 'Free template with {{input}} (no API cost).', hasIn: true, hasOut: true, default: 'Summarize this:\n{{input}}' },
  ai: { label: 'AI (OpenRouter)', desc: 'LLM call. Needs key + model above.', hasIn: true, hasOut: true, default: 'Answer about:\n{{input}}', systemDefault: 'You are a helpful assistant. Be concise.' },
  code: { label: 'Code JS', desc: 'JS with `input`, must return a value.', hasIn: true, hasOut: true, default: '// `input` is upstream text\nreturn input.toUpperCase();' },
  output: { label: 'Output', desc: 'Displays final value. No output port.', hasIn: true, hasOut: false, default: '' },
};

let nodes = new Map(); // id -> {id,type,title,x,y,content}
let edges = []; // {id,from,to}
let seq = 1;
let selectedEdgeId = null;

// view state
let scale = 1, panX = 200, panY = 80;

const viewport = document.getElementById('viewport');
const world = document.getElementById('world');
const nodesEl = document.getElementById('nodes');
const edgesSvg = document.getElementById('edges');
const dragEdge = document.getElementById('dragEdge');
const logEl = document.getElementById('log');

function log(msg, cls = 'info') {
  const div = document.createElement('div');
  div.className = cls;
  div.textContent = msg;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

function applyView() {
  world.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  document.getElementById('zoomLabel').textContent = Math.round(scale * 100) + '%';
}

function clientToWorld(cx, cy) {
  const r = viewport.getBoundingClientRect();
  return { x: (cx - r.left - panX) / scale, y: (cy - r.top - panY) / scale };
}

function uid(prefix) { return prefix + '_' + (seq++) + '_' + Date.now().toString(36); }

// ---------- palette ----------
function renderPalette() {
  const wrap = document.getElementById('paletteItems');
  wrap.innerHTML = '';
  for (const [type, def] of Object.entries(NODE_DEFS)) {
    const d = document.createElement('div');
    d.className = 'palette-item';
    d.draggable = true;
    d.innerHTML = `<div class="row"><strong>${def.label}</strong><button class="add" title="Add">+</button></div><small>${def.desc}</small>`;
    d.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/x-node-type', type);
      e.dataTransfer.effectAllowed = 'copy';
    });
    d.querySelector('.add').addEventListener('click', () => {
      const c = viewport.getBoundingClientRect();
      const center = clientToWorld(c.left + c.width / 2, c.top + c.height / 2);
      spawnNode(type, center.x - 130, center.y - 60);
    });
    wrap.appendChild(d);
  }
}

viewport.addEventListener('dragover', (e) => e.preventDefault());
viewport.addEventListener('drop', (e) => {
  e.preventDefault();
  const type = e.dataTransfer.getData('text/x-node-type');
  if (!type || !NODE_DEFS[type]) return;
  const p = clientToWorld(e.clientX, e.clientY);
  spawnNode(type, p.x - 130, p.y - 40);
});

// ---------- nodes ----------
function spawnNode(type, x, y) {
  const id = uid(type);
  nodes.set(id, {
    id, type,
    title: NODE_DEFS[type].label + ' ' + seq,
    x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)),
    content: NODE_DEFS[type].default,
    system: NODE_DEFS[type].systemDefault || '',
    output: '', status: '', statusText: 'idle',
  });
  createNodeEl(nodes.get(id));
  renderEdges();
  log(`Spawned ${type} (${id.slice(0, 12)}…)`, 'info');
}

function createNodeEl(n) {
  const def = NODE_DEFS[n.type];
  const el = document.createElement('div');
  el.className = 'node';
  el.id = 'node_' + n.id;
  el.style.left = n.x + 'px';
  el.style.top = n.y + 'px';
  el.innerHTML = `
    ${def.hasIn ? '<div class="port in" data-port="in" title="Input: drop a connection here"><span class="port-label">in</span></div>' : ''}
    <div class="node-header">
      <span class="node-type type-${n.type}">${n.type}</span>
      <input class="node-title" value="" spellcheck="false" />
      <button class="node-del" title="Delete node">×</button>
    </div>
    <div class="node-body"></div>
    ${def.hasOut ? '<div class="port out" data-port="out" title="Output: drag to connect"><span class="port-out-label">out</span></div>' : ''}
  `;
  el.querySelector('.node-title').value = n.title;
  el.querySelector('.node-title').addEventListener('input', (e) => { n.title = e.target.value; });
  el.querySelector('.node-del').addEventListener('click', () => deleteNode(n.id));

  const body = el.querySelector('.node-body');
  if (n.type === 'ai') {
    const sysLabel = document.createElement('div');
    sysLabel.className = 'field-label';
    sysLabel.textContent = 'System prompt';
    body.appendChild(sysLabel);
    const sys = document.createElement('textarea');
    sys.className = 'small';
    sys.value = n.system;
    sys.spellcheck = false;
    sys.placeholder = 'You are a helpful assistant…';
    sys.addEventListener('input', () => { n.system = sys.value; setStatus(n, '', 'idle'); });
    sys.addEventListener('mousedown', (e) => e.stopPropagation());
    body.appendChild(sys);
    const userLabel = document.createElement('div');
    userLabel.className = 'field-label';
    userLabel.textContent = 'User template (use {{input}})';
    body.appendChild(userLabel);
    const ta = document.createElement('textarea');
    ta.value = n.content;
    ta.spellcheck = false;
    ta.addEventListener('input', () => { n.content = ta.value; setStatus(n, '', 'idle'); });
    ta.addEventListener('mousedown', (e) => e.stopPropagation());
    body.appendChild(ta);
  } else if (n.type !== 'output') {
    const ta = document.createElement('textarea');
    if (n.type === 'input') ta.classList.add('small');
    ta.value = n.content;
    ta.spellcheck = false;
    ta.addEventListener('input', () => { n.content = ta.value; setStatus(n, '', 'idle'); });
    ta.addEventListener('mousedown', (e) => e.stopPropagation());
    body.appendChild(ta);
  } else {
    const info = document.createElement('div');
    info.className = 'muted';
    info.textContent = 'Shows the upstream result after Run.';
    body.appendChild(info);
  }
  const preview = document.createElement('div');
  preview.className = 'output-preview';
  preview.textContent = '— no output yet —';
  body.appendChild(preview);
  const st = document.createElement('div');
  st.className = 'status';
  st.textContent = 'idle';
  body.appendChild(st);
  n._preview = preview; n._status = st;

  // drag node by header (and body background, not textarea)
  el.querySelector('.node-header').addEventListener('mousedown', (e) => {
    if (e.target.closest('button') || e.target.closest('input')) return;
    startNodeDrag(e, n);
  });
  el.addEventListener('mousedown', (e) => {
    document.querySelectorAll('.node.selected-node').forEach(x => x.classList.remove('selected-node'));
    el.classList.add('selected-node');
  });

  // edge wiring
  const outPort = el.querySelector('.port.out');
  if (outPort) outPort.addEventListener('mousedown', (e) => { e.stopPropagation(); startEdgeDrag(e, n); });
  const inPort = el.querySelector('.port.in');
  if (inPort) {
    inPort.addEventListener('mouseup', () => finishEdgeDrag(n));
    inPort.addEventListener('mouseenter', () => { if (pendingEdge) inPort.classList.add('highlight'); });
    inPort.addEventListener('mouseleave', () => inPort.classList.remove('highlight'));
  }

  nodesEl.appendChild(el);
}

function deleteNode(id) {
  edges = edges.filter(e => e.from !== id && e.to !== id);
  document.getElementById('node_' + id)?.remove();
  nodes.delete(id);
  selectedEdgeId = null;
  renderEdges();
}

function setStatus(n, text, kind) {
  n.statusText = text;
  if (!n._status) return;
  n._status.textContent = text || 'idle';
  n._status.className = 'status' + (kind === 'ok' ? ' ok' : kind === 'err' ? ' err' : kind === 'run' ? ' run' : '');
}

function setPreview(n, text) {
  n.output = text ?? '';
  if (n._preview) n._preview.textContent = n.output === '' ? '— no output yet —' : String(n.output).slice(0, 2000);
}

// node dragging
function startNodeDrag(e, n) {
  e.preventDefault(); e.stopPropagation();
  const el = document.getElementById('node_' + n.id);
  const startX = e.clientX, startY = e.clientY;
  const ox = n.x, oy = n.y;
  const move = (ev) => {
    n.x = Math.max(0, Math.round(ox + (ev.clientX - startX) / scale));
    n.y = Math.max(0, Math.round(oy + (ev.clientY - startY) / scale));
    el.style.left = n.x + 'px';
    el.style.top = n.y + 'px';
    renderEdges();
  };
  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

// ---------- edges ----------
let pendingEdge = null; // {from}

function portCenter(nodeId, which) {
  const el = document.getElementById('node_' + nodeId);
  if (!el) return { x: 0, y: 0 };
  const cx = el.offsetLeft + el.offsetWidth / 2;
  if (which === 'in') return { x: cx, y: el.offsetTop };
  return { x: cx, y: el.offsetTop + el.offsetHeight };
}

function edgePath(a, b) {
  const dy = Math.max(40, Math.abs(b.y - a.y) / 2);
  return `M ${a.x} ${a.y} C ${a.x} ${a.y + dy}, ${b.x} ${b.y - dy}, ${b.x} ${b.y}`;
}

function wouldCycle(fromId, toId) {
  // is there already a path toId -> ... -> fromId?
  const adj = new Map();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from).push(e.to);
  }
  const stack = [toId], seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (cur === fromId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const nx of (adj.get(cur) || [])) stack.push(nx);
  }
  return false;
}

function startEdgeDrag(e, fromNode) {
  e.preventDefault();
  pendingEdge = { from: fromNode.id };
  dragEdge.classList.remove('hidden');
  const move = (ev) => {
    if (!pendingEdge) return;
    const a = portCenter(fromNode.id, 'out');
    // drag edge layer is inside world, so convert client -> world
    const p = clientToWorld(ev.clientX, ev.clientY);
    dragEdge.setAttribute('d', edgePath(a, p));
  };
  const up = (ev) => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    dragEdge.classList.add('hidden');
    dragEdge.setAttribute('d', '');
    document.querySelectorAll('.port.highlight').forEach(x => x.classList.remove('highlight'));
    pendingEdge = null;
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

function finishEdgeDrag(toNode) {
  if (!pendingEdge) return;
  const fromId = pendingEdge.from, toId = toNode.id;
  const def = NODE_DEFS[toNode.type];
  if (!def.hasIn) { log('Target has no input port.', 'err'); return; }
  if (fromId === toId) { log('Cannot connect a box to itself.', 'err'); return; }
  if (edges.some(e => e.from === fromId && e.to === toId)) { log('Already connected.', 'err'); return; }
  if (wouldCycle(fromId, toId)) { log('Blocked: that would create a cycle.', 'err'); return; }
  // single inbound per port: replace existing edge into target
  edges = edges.filter(e => e.to !== toId);
  edges.push({ id: uid('e'), from: fromId, to: toId });
  renderEdges();
  log(`Connected ${nodes.get(fromId).title} → ${nodes.get(toId).title}`, 'ok');
}

function renderEdges() {
  edgesSvg.innerHTML = '';
  // size svg to world
  edgesSvg.setAttribute('viewBox', `0 0 4000 3000`);
  for (const e of edges) {
    const a = portCenter(e.from, 'out');
    const b = portCenter(e.to, 'in');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', edgePath(a, b));
    p.setAttribute('class', 'edge' + (e.id === selectedEdgeId ? ' selected' : ''));
    p.addEventListener('mousedown', (ev) => { ev.stopPropagation(); selectedEdgeId = e.id; renderEdges(); });
    p.addEventListener('contextmenu', (ev) => { ev.preventDefault(); edges = edges.filter(x => x.id !== e.id); selectedEdgeId = null; renderEdges(); });
    edgesSvg.appendChild(p);
  }
}

document.addEventListener('keydown', (e) => {
  const tag = (document.activeElement?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea') return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedEdgeId) {
    edges = edges.filter(x => x.id !== selectedEdgeId);
    selectedEdgeId = null;
    renderEdges();
  }
});

// ---------- pan & zoom ----------
let panning = null;
viewport.addEventListener('mousedown', (e) => {
  if (e.target.closest('.node') || e.target.closest('.port')) return;
  panning = { sx: e.clientX, sy: e.clientY, ox: panX, oy: panY };
  viewport.classList.add('panning');
});
window.addEventListener('mousemove', (e) => {
  if (!panning) return;
  panX = panning.ox + (e.clientX - panning.sx);
  panY = panning.oy + (e.clientY - panning.sy);
  applyView();
});
window.addEventListener('mouseup', () => { panning = null; viewport.classList.remove('panning'); });
viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  const f = e.deltaY < 0 ? 1.08 : 0.92;
  scale = Math.min(1.8, Math.max(0.4, scale * f));
  applyView();
}, { passive: false });

document.getElementById('zoomIn').onclick = () => { scale = Math.min(1.8, scale * 1.15); applyView(); };
document.getElementById('zoomOut').onclick = () => { scale = Math.max(0.4, scale / 1.15); applyView(); };
document.getElementById('resetView').onclick = () => { scale = 1; panX = 200; panY = 80; applyView(); };

// ---------- execution ----------
const KEY_LS = 'flowboxes.openrouter.key';
const MODEL_LS = 'flowboxes.openrouter.model';

function getSettings() {
  return {
    apiKey: (document.getElementById('apiKey')?.value || localStorage.getItem(KEY_LS) || '').trim(),
    model: document.getElementById('modelSelect')?.value || localStorage.getItem(MODEL_LS) || 'openai/gpt-4o-mini',
  };
}

function updateKeyStatus() {
  const has = !!(localStorage.getItem(KEY_LS) || '').trim();
  const el = document.getElementById('keyStatus');
  if (!el) return;
  el.textContent = has ? '● Key saved' : '○ No key';
  el.classList.toggle('saved', has);
  el.title = has ? 'OpenRouter key saved in this browser' : 'No key saved — click API Key…';
}

function openKeyMenu() {
  document.getElementById('keyModal')?.classList.remove('hidden');
  const input = document.getElementById('apiKey');
  if (input && !input.value) input.value = localStorage.getItem(KEY_LS) || '';
  setTimeout(() => input?.focus(), 0);
}
function closeKeyMenu() {
  document.getElementById('keyModal')?.classList.add('hidden');
}

async function callOpenRouter({ apiKey, model, system, user }) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
      'HTTP-Referer': location.href,
      'X-Title': 'FlowBoxes',
    },
    body: JSON.stringify({
      model,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || await res.text(); } catch { detail = await res.text().catch(() => ''); }
    const hint = res.status === 401 ? ' — bad/expired key?'
      : res.status === 402 ? ' — no credits?'
      : res.status === 429 ? ' — rate limited, retry later' : '';
    throw new Error(`OpenRouter ${res.status}${hint}${detail ? ': ' + String(detail).slice(0, 200) : ''}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Empty response from model.');
  return typeof text === 'string' ? text : JSON.stringify(text);
}
function topoOrder() {
  const indeg = new Map([...nodes.keys()].map(id => [id, 0]));
  const adj = new Map();
  for (const e of edges) {
    adj.set(e.from, [...(adj.get(e.from) || []), e.to]);
    indeg.set(e.to, (indeg.get(e.to) || 0) + 1);
  }
  const q = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const order = [];
  while (q.length) {
    const cur = q.shift();
    order.push(cur);
    for (const nx of (adj.get(cur) || [])) {
      indeg.set(nx, indeg.get(nx) - 1);
      if (indeg.get(nx) === 0) q.push(nx);
    }
  }
  return order.length === nodes.size ? order : null;
}

async function runAll() {
  if (nodes.size === 0) { log('Nothing to run — spawn some boxes first.', 'err'); return; }
  const order = topoOrder();
  if (!order) { log('Cycle detected — remove a connection.', 'err'); return; }
  const inbound = new Map();
  for (const e of edges) inbound.set(e.to, e.from);
  const { apiKey, model } = getSettings();
  const needsAI = order.some(id => nodes.get(id).type === 'ai');
  if (needsAI && !apiKey) {
    log('AI node needs an OpenRouter key — opening key menu…', 'err');
    openKeyMenu();
  }
  const runBtn = document.getElementById('runBtn');
  runBtn.disabled = true;
  log(`Running ${order.length} box(es)…`, 'info');
  for (const id of order) {
    const n = nodes.get(id);
    const upId = inbound.get(id);
    const inputVal = upId ? String(nodes.get(upId)?.output ?? '') : '';
    setStatus(n, 'running…', 'run');
    // let the UI paint the running state before awaiting network
    await new Promise(r => setTimeout(r, 0));
    try {
      let out = '';
      if (n.type === 'input') out = n.content;
      else if (n.type === 'prompt') {
        out = n.content.includes('{{input}}')
          ? n.content.split('{{input}}').join(inputVal)
          : (inputVal ? n.content + '\n' + inputVal : n.content);
      } else if (n.type === 'ai') {
        if (!apiKey) throw new Error('Missing OpenRouter key.');
        const user = n.content.includes('{{input}}')
          ? n.content.split('{{input}}').join(inputVal)
          : (inputVal ? n.content + '\n' + inputVal : n.content);
        out = await callOpenRouter({ apiKey, model, system: n.system, user });
      } else if (n.type === 'code') {
        const fn = new Function('input', n.content);
        const r = fn(inputVal);
        out = r == null ? '' : (typeof r === 'object' ? JSON.stringify(r, null, 2) : String(r));
      } else if (n.type === 'output') out = inputVal;
      setPreview(n, out);
      setStatus(n, 'ok', 'ok');
      log(`✓ ${n.title}: ${String(out).slice(0, 120)}${String(out).length > 120 ? '…' : ''}`, 'ok');
    } catch (err) {
      setPreview(n, '');
      setStatus(n, 'error: ' + err.message, 'err');
      log(`✗ ${n.title}: ${err.message}`, 'err');
    }
  }
  runBtn.disabled = false;
}

document.getElementById('keyBtn').addEventListener('click', openKeyMenu);
document.getElementById('closeKey').addEventListener('click', closeKeyMenu);
document.getElementById('keyModal').addEventListener('mousedown', (e) => {
  if (e.target.id === 'keyModal') closeKeyMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeKeyMenu();
});
document.getElementById('toggleKey').addEventListener('click', () => {
  const k = document.getElementById('apiKey');
  const show = k.type === 'password';
  k.type = show ? 'text' : 'password';
  document.getElementById('toggleKey').textContent = show ? 'hide' : 'show';
});
document.getElementById('saveKey').addEventListener('click', () => {
  const v = document.getElementById('apiKey').value.trim();
  const msg = document.getElementById('keyMsg');
  if (!v) { msg.textContent = 'Paste a key first.'; msg.className = 'status err'; return; }
  if (!v.startsWith('sk-or-')) {
    msg.textContent = 'Warning: key usually starts with sk-or-… saving anyway.';
    msg.className = 'status run';
  } else {
    msg.textContent = 'Key saved in this browser.';
    msg.className = 'status ok';
  }
  try { localStorage.setItem(KEY_LS, v); } catch { msg.textContent = 'Could not save (storage blocked).'; msg.className = 'status err'; return; }
  updateKeyStatus();
  log('OpenRouter key saved.', 'ok');
});
document.getElementById('clearKey').addEventListener('click', () => {
  localStorage.removeItem(KEY_LS);
  document.getElementById('apiKey').value = '';
  document.getElementById('keyMsg').textContent = 'Key cleared.';
  document.getElementById('keyMsg').className = 'status';
  updateKeyStatus();
  log('OpenRouter key cleared.', 'info');
});
document.getElementById('modelSelect').addEventListener('change', (e) => {
  try { localStorage.setItem(MODEL_LS, e.target.value); } catch {}
});

document.getElementById('runBtn').addEventListener('click', runAll);
document.getElementById('clearBtn').addEventListener('click', () => {
  for (const n of nodes.values()) { setPreview(n, ''); setStatus(n, 'idle', ''); }
  log('Outputs cleared.', 'info');
});
document.getElementById('clearAllBtn').addEventListener('click', () => {
  nodes.clear(); edges = []; nodesEl.innerHTML = ''; selectedEdgeId = null; renderEdges();
  log('Canvas cleared.', 'info');
});

window.addEventListener('resize', renderEdges);

// ---------- init ----------
try {
  const savedKey = localStorage.getItem(KEY_LS) || '';
  const savedModel = localStorage.getItem(MODEL_LS);
  if (savedModel) document.getElementById('modelSelect').value = savedModel;
  // modal input exists after HTML edit; prefill so Run works immediately
  const kInput = document.getElementById('apiKey');
  if (kInput && savedKey) kInput.value = savedKey;
} catch {}
updateKeyStatus();
renderPalette();
applyView();
// demo graph so first open is self-explanatory
spawnNode('input', 300, 200);
spawnNode('code', 700, 200);
spawnNode('output', 1100, 200);
{
  const ids = [...nodes.keys()];
  const byType = (t) => ids.find(id => nodes.get(id).type === t);
  edges.push({ id: uid('e'), from: byType('input'), to: byType('code') });
  edges.push({ id: uid('e'), from: byType('code'), to: byType('output') });
  renderEdges();
}
log('Ready. Drag ports to connect, then press Run.', 'info');
