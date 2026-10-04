/** Text callers for Provider boxes (one per provider). */

type ChatMsg = { role: string; content: string };

function errWithStatus(status: number, prefix: string, detail: string): Error {
  const e = new Error(`${prefix} ${status}${detail ? ': ' + detail : ''}`) as Error & { status?: number };
  e.status = status;
  return e;
}

async function readError(res: Response): Promise<string> {
  try {
    const j = await res.json();
    return (j?.error?.message || JSON.stringify(j)).slice(0, 200);
  } catch {
    try {
      return (await res.text()).slice(0, 200);
    } catch {
      return '';
    }
  }
}

export async function callGeminiText(opts: { prompt: string; system: string; key: string; model: string; signal?: AbortSignal }): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent`,
    {
      method: 'POST',
      signal: opts.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.key },
      body: JSON.stringify({
        ...(opts.system ? { system_instruction: { parts: [{ text: opts.system }] } } : {}),
        contents: [{ parts: [{ text: opts.prompt }] }],
      }),
    }
  );
  if (!res.ok) throw errWithStatus(res.status, 'Gemini', await readError(res));
  const data = await res.json();
  const parts = (data?.candidates?.[0]?.content?.parts || []) as { text?: string }[];
  const text = parts.map((p) => p?.text || '').join('').trim();
  if (!text) throw new Error('Empty response from model.');
  return text;
}

export async function callPollinationsText(opts: { prompt: string; system: string; model: string; signal?: AbortSignal }): Promise<string> {
  const msgs: ChatMsg[] = [
    ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
    { role: 'user', content: opts.prompt },
  ];
  const res = await fetch('https://text.pollinations.ai/openai', {
    method: 'POST',
    signal: opts.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: opts.model, messages: msgs }),
  });
  if (!res.ok) throw errWithStatus(res.status, 'Pollinations', await readError(res));
  const data = await res.json();
  const text = (data?.choices?.[0]?.message?.content || '').trim();
  if (!text) throw new Error('Empty response from model.');
  return text;
}

export async function callCustomText(opts: { base: string; prompt: string; system: string; key: string; model: string; signal?: AbortSignal }): Promise<string> {
  const base = opts.base.trim().replace(/\/+$/, '');
  if (!base) throw new Error('Custom provider needs a Base URL.');
  if (!opts.model.trim()) throw new Error('Custom provider needs a model id.');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    signal: opts.signal,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.key ? { Authorization: 'Bearer ' + opts.key } : {}),
    },
    body: JSON.stringify({
      model: opts.model.trim(),
      messages: [
        ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
        { role: 'user', content: opts.prompt },
      ],
    }),
  });
  if (!res.ok) throw errWithStatus(res.status, 'Custom', await readError(res));
  const data = await res.json();
  const text = (data?.choices?.[0]?.message?.content || '').trim();
  if (!text) throw new Error('Empty response from model.');
  return text;
}

export async function callHFText(opts: { prompt: string; system: string; model: string; token: string; signal?: AbortSignal }): Promise<string> {
  const input = opts.system ? `${opts.system}\n\n${opts.prompt}` : opts.prompt;
  const res = await fetch(`https://api-inference.huggingface.co/models/${opts.model}`, {
    method: 'POST',
    signal: opts.signal,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + opts.token },
    body: JSON.stringify({ inputs: input, parameters: { max_new_tokens: 512, return_full_text: false } }),
  });
  if (!res.ok) {
    const d = await readError(res);
    if (res.status === 503) throw new Error('HF model loading, retry in ~20s.');
    throw errWithStatus(res.status, 'HuggingFace', d);
  }
  const data = await res.json();
  const arr = Array.isArray(data) ? data : [data];
  const text = String(arr[0]?.generated_text || '').trim();
  if (!text) throw new Error('Empty response from model.');
  return text;
}
