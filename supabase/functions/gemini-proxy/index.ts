// Supabase Edge Function: gemini-proxy
// Deploy: supabase functions deploy gemini-proxy
// Secret: supabase secrets set GEMINI_API_KEY=your_key

const DEFAULT_MODEL = 'gemini-2.5-flash';
const ALLOWED_MODELS = new Set(['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-pro']);
const rateBuckets = new Map<string, number[]>();

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Cache-Control': 'no-store',
};

function jsonResponse(body: unknown, status = 200, headers = corsHeaders) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    const origin = req.headers.get('origin');
    const allowed = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map((v) => v.trim()).filter(Boolean);
    if (origin && (!allowed.length || !allowed.includes(origin))) return new Response('forbidden', { status: 403, headers: corsHeaders });
    const headers = origin && allowed.includes(origin) ? { ...corsHeaders, 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : corsHeaders;
    return new Response('ok', { headers });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method Not Allowed. Use POST.' }, 405);
  }

  const configuredOrigins = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map((v) => v.trim()).filter(Boolean);
  const origin = req.headers.get('origin');
  if (origin && (!configuredOrigins.length || !configuredOrigins.includes(origin))) return jsonResponse({ error: 'Origin không được phép.' }, 403);
  const responseHeaders = origin && configuredOrigins.includes(origin)
    ? { ...corsHeaders, 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' }
    : corsHeaders;
  const ip = (req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || 'unknown').trim().slice(0, 128);
  const now = Date.now();
  const recent = (rateBuckets.get(ip) || []).filter((time) => now - time < 60000);
  recent.push(now);
  rateBuckets.set(ip, recent);
  if (rateBuckets.size > 10000) {
    for (const [key, times] of rateBuckets) if (!times.length || now - times[times.length - 1] >= 60000) rateBuckets.delete(key);
  }
  if (recent.length > 30) return jsonResponse({ error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.' }, 429);

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'Dịch vụ chưa được cấu hình.' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const contentLength = Number(req.headers.get('content-length') || 0);
    if (contentLength > 256 * 1024) return jsonResponse({ error: 'Payload quá lớn.' }, 413, responseHeaders);
    let body: Record<string, any>;
    try { body = await req.json(); } catch { return jsonResponse({ error: 'JSON không hợp lệ.' }, 400, responseHeaders); }
    const rawModel = String(body?.model || DEFAULT_MODEL).trim();
    const model = ALLOWED_MODELS.has(rawModel) ? rawModel : DEFAULT_MODEL;

    let contents = body?.contents;
    if (!Array.isArray(contents) && typeof body?.prompt === 'string' && body.prompt.trim()) {
      contents = [{ role: 'user', parts: [{ text: body.prompt.trim() }] }];
    }
    if (!Array.isArray(contents) || contents.length === 0 || contents.length > 32) {
      return new Response(JSON.stringify({ error: 'Thiếu nội dung (contents hoặc prompt).' }), {
        status: 400,
        headers: { ...responseHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payload: Record<string, unknown> = { contents };
    if (body?.systemInstruction) {
      payload.systemInstruction = typeof body.systemInstruction === 'string'
        ? { parts: [{ text: body.systemInstruction }] }
        : body.systemInstruction;
    }
    if (body?.generationConfig && typeof body.generationConfig === 'object') {
      const generationConfig = { ...body.generationConfig };
      const requestedTokens = Number(generationConfig.maxOutputTokens);
      generationConfig.maxOutputTokens = Number.isFinite(requestedTokens) ? Math.min(4096, Math.max(1, requestedTokens)) : 4096;
      payload.generationConfig = generationConfig;
    }

    const upstreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const upstreamResp = await fetch(upstreamUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25000),
    });

    const data = await upstreamResp.json().catch(() => ({}));
    if (!upstreamResp.ok) {
      return new Response(
        JSON.stringify({ error: upstreamResp.status >= 400 && upstreamResp.status < 500 ? 'Yêu cầu Gemini không thành công.' : 'Dịch vụ Gemini tạm thời không khả dụng.' }),
        { status: upstreamResp.status >= 400 && upstreamResp.status < 500 ? upstreamResp.status : 502, headers: { ...responseHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const text = data?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p?.text || '')
      .join('') || '';

    return new Response(
      JSON.stringify({
        ok: true,
        model,
        text,
        candidates: data?.candidates || [],
        usageMetadata: data?.usageMetadata || null,
      }),
      { status: 200, headers: { ...responseHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Lỗi máy chủ khi gọi Gemini API.' }),
      { status: 500, headers: { ...responseHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
