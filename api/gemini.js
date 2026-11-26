/**
 * Vercel Serverless Function: /api/gemini
 * Proxies Gemini API requests server-side using process.env.GEMINI_API_KEY.
 */
const DEFAULT_MODEL = 'gemini-2.5-flash';
const ALLOWED_MODELS = new Set([
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-flash-lite-latest',
    'gemini-3.1-flash-lite-preview',
    'gemini-flash-latest'
]);
const FALLBACK_MODELS = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-flash-lite-latest',
    'gemini-3.1-flash-lite-preview',
    'gemini-flash-latest'
];
const MODEL_TIMEOUT_MS = 6000;
const rateBuckets = new Map();
const SYSTEM_ERROR = 'Lỗi máy chủ khi gọi Gemini API.';
const OVERLOAD_ERROR = 'Các model Gemini hiện đang quá tải hoặc đã hết quota. Vui lòng thử lại sau ít phút.';

function clientError(res, status, error) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(status).json({ error });
}

function allowedOrigin(req) {
    const configured = String(process.env.ALLOWED_ORIGINS || '').split(',').map((v) => v.trim()).filter(Boolean);
    const origin = req.headers.origin;
    return !configured.length || !origin || configured.includes(origin);
}

function rateLimited(req) {
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    const now = Date.now();
    const recent = (rateBuckets.get(ip) || []).filter((time) => now - time < 60000);
    recent.push(now);
    rateBuckets.set(ip, recent);
    return recent.length > 30;
}

module.exports = async function handler(req, res) {
    const origin = req.headers.origin;
    const isOriginAllowed = allowedOrigin(req);
    const hasConfiguredOrigins = Boolean(String(process.env.ALLOWED_ORIGINS || '').trim());
    res.setHeader('Access-Control-Allow-Origin', hasConfiguredOrigins ? (isOriginAllowed && origin ? origin : 'null') : '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-gemini-api-key');
    res.setHeader('Cache-Control', 'no-store');

    if (!isOriginAllowed) return clientError(res, 403, 'Origin không được phép.');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'POST') {
        return clientError(res, 405, 'Method Not Allowed. Use POST.');
    }

    if (rateLimited(req)) return clientError(res, 429, 'Quá nhiều yêu cầu. Vui lòng thử lại sau.');

    let body;
    try {
        body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    } catch {
        return clientError(res, 400, 'JSON không hợp lệ.');
    }

    const apiKey = String(process.env.GEMINI_API_KEY || '').trim()
        || String(req.headers['x-gemini-api-key'] || body?.apiKey || '').trim();
    if (!apiKey) {
        return clientError(res, 500, 'Dịch vụ chưa được cấu hình. Vui lòng nhập Gemini API Key trong Admin hoặc cấu hình GEMINI_API_KEY.');
    }
    try {
        const rawModel = String(body.model || DEFAULT_MODEL).trim();
        const model = ALLOWED_MODELS.has(rawModel) ? rawModel : DEFAULT_MODEL;

        let contents = body.contents;
        if (!Array.isArray(contents) && typeof body.prompt === 'string' && body.prompt.trim()) {
            contents = [{ role: 'user', parts: [{ text: body.prompt.trim() }] }];
        }
        if (!Array.isArray(contents) || contents.length === 0) {
            return clientError(res, 400, 'Thiếu nội dung (contents hoặc prompt).');
        }

        const payload = { contents };
        if (body.systemInstruction) {
            payload.systemInstruction = typeof body.systemInstruction === 'string'
                ? { parts: [{ text: body.systemInstruction }] }
                : body.systemInstruction;
        }
        if (body.generationConfig && typeof body.generationConfig === 'object') {
            const generationConfig = { ...body.generationConfig };
            const requestedTokens = Number(generationConfig.maxOutputTokens);
            generationConfig.maxOutputTokens = Number.isFinite(requestedTokens)
                ? Math.min(4096, Math.max(1, requestedTokens)) : 4096;
            payload.generationConfig = generationConfig;
        }

        const candidateModels = Array.from(new Set([model, ...FALLBACK_MODELS]));

        let finalData = null;
        let finalModel = model;
        let lastStatus = 502;
        let lastMsg = 'Yêu cầu Gemini không thành công.';
        let retryableFailure = false;

        for (const candidateModel of candidateModels) {
            const upstreamPayload = { ...payload };
            if (candidateModel === 'gemini-2.5-flash') {
                upstreamPayload.generationConfig = {
                    ...(payload.generationConfig || {}),
                    thinkingConfig: payload.generationConfig?.thinkingConfig || { thinkingBudget: 0 }
                };
            } else if (upstreamPayload.generationConfig?.thinkingConfig) {
                upstreamPayload.generationConfig = { ...upstreamPayload.generationConfig };
                delete upstreamPayload.generationConfig.thinkingConfig;
            }
            const upstreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidateModel)}:generateContent`;
            try {
                const upstreamResp = await fetch(upstreamUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
                    body: JSON.stringify(upstreamPayload),
                    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS)
                });

                const data = await upstreamResp.json().catch(() => ({}));
                if (upstreamResp.ok) {
                    finalData = data;
                    finalModel = candidateModel;
                    break;
                }
                lastStatus = upstreamResp.status >= 400 && upstreamResp.status < 500 ? upstreamResp.status : 502;
                lastMsg = data?.error?.message || 'Yêu cầu Gemini không thành công.';
                // Chỉ fallback model khi lỗi do model/quota/tạm quá tải (404, 429, 5xx)
                if (![404, 429].includes(upstreamResp.status) && upstreamResp.status < 500) {
                    break;
                }
                retryableFailure = true;
            } catch (modelErr) {
                if (modelErr?.name === 'TimeoutError' || modelErr?.name === 'AbortError') {
                    lastStatus = 504;
                    lastMsg = 'Kết nối tới Gemini API bị quá thời gian (timeout).';
                    retryableFailure = true;
                    continue;
                }
                throw modelErr;
            }
        }

        if (!finalData) {
            return clientError(res, retryableFailure ? 503 : lastStatus, retryableFailure ? OVERLOAD_ERROR : lastMsg);
        }

        const text = finalData?.candidates?.[0]?.content?.parts
            ?.map((p) => p?.text || '')
            .join('') || '';

        return res.status(200).json({
            ok: true,
            model: finalModel,
            text,
            candidates: finalData?.candidates || [],
            usageMetadata: finalData?.usageMetadata || null
        });
    } catch (err) {
        if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
            return clientError(res, 504, 'Kết nối tới Gemini API bị quá thời gian (timeout).');
        }
        return clientError(res, 500, SYSTEM_ERROR);
    }
};
