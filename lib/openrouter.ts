export async function callOpenRouter(opts: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  signal?: AbortSignal;
}): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal: opts.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + opts.apiKey,
      'HTTP-Referer': typeof location !== 'undefined' ? location.href : '',
      'X-Title': 'FlowBoxes',
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [
        ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
        { role: 'user', content: opts.user },
      ],
    }),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = j?.error?.message || JSON.stringify(j).slice(0, 200);
    } catch {
      try {
        detail = (await res.text()).slice(0, 200);
      } catch {}
    }
    const hint =
      res.status === 401
        ? ' — bad/expired key?'
        : res.status === 402
          ? ' — no credits? (free quota spent, resets daily)'
          : res.status === 429
            ? ' — rate limited, resets daily'
            : res.status === 404
              ? ' — model retired/unavailable'
              : '';
    const err = new Error(
      `OpenRouter ${res.status}${hint}${detail ? ': ' + detail : ''}`
    ) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Empty response from model.');
  return typeof text === 'string' ? text : JSON.stringify(text);
}

export function isLimitError(err: unknown): boolean {
  const s = (err as { status?: number })?.status;
  return s === 429 || s === 402;
}

/** 404 = slug retired/renamed: also worth falling through to the next model. */
export function isNotFoundError(err: unknown): boolean {
  return (err as { status?: number })?.status === 404;
}
