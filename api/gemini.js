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
const MAX_MODEL_ATTEMPTS = 2;
const MAX_BODY_BYTES = 65536;
const MAX_CONTENTS_ITEMS = 10;
const MAX_PARTS_PER_ITEM = 8;
const MAX_TOTAL_PARTS = 20;
const MAX_CONTENTS_TEXT_LENGTH = 16000;
const MAX_SYSTEM_INSTRUCTION_LENGTH = 4000;
const MAX_BUCKETS = 1000;
const RATE_WINDOW_MS = 60000;
const RATE_LIMIT_MAX = 30;
const rateBuckets = new Map();
let lastPruneAt = 0;
const SYSTEM_ERROR = 'Lỗi máy chủ khi gọi Gemini API.';
const OVERLOAD_ERROR = 'Các model Gemini hiện đang quá tải hoặc đã hết quota. Vui lòng thử lại sau ít phút.';

function clientError(res, status, error) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(status).json({ error });
}

function allowedOrigin(req) {
    const configured = String(process.env.ALLOWED_ORIGINS || '')
        .split(',').map((value) => value.trim()).filter(Boolean);
    const { origin, host } = req.headers;
    if (origin !== undefined) return Boolean(origin && origin !== '*' && origin !== 'null' && configured.includes(origin));
    if (req.headers['sec-fetch-site'] !== 'same-origin' || !host) return false;
    return configured.some((value) => {
        try {
            return new URL(value).host === host.toLowerCase();
        } catch {
            return false;
        }
    });
}

function firstAddress(value) {
    return String(value || '').split(',')[0].trim();
}

function rateLimited(req) {
    const ip = firstAddress(req.headers['x-vercel-forwarded-for'])
        || firstAddress(req.headers['x-real-ip']) || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const cutoff = now - RATE_WINDOW_MS;
    if (now - lastPruneAt >= RATE_WINDOW_MS || rateBuckets.size >= MAX_BUCKETS) {
        for (const [key, timestamps] of rateBuckets) {
            if (timestamps[timestamps.length - 1] <= cutoff) rateBuckets.delete(key);
        }
        lastPruneAt = now;
    }

    const existing = rateBuckets.get(ip);
    if (!existing && rateBuckets.size >= MAX_BUCKETS) {
        rateBuckets.delete(rateBuckets.keys().next().value);
    }
    const recent = (existing || []).filter((time) => time > cutoff);
    const limited = recent.length >= RATE_LIMIT_MAX;
    if (!limited) recent.push(now);
    rateBuckets.delete(ip);
    rateBuckets.set(ip, recent);
    return limited;
}

function isPlainObject(value) {
    if (!value || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function isTextPart(part) {
    return isPlainObject(part) && typeof part.text === 'string'
        && Object.keys(part).every((key) => key === 'text');
}

function validatePayload(body) {
    if (!isPlainObject(body)) return { status: 400, error: 'Body must be a JSON object.' };
    if (body.prompt !== undefined && typeof body.prompt !== 'string') {
        return { status: 400, error: 'Prompt must be a string.' };
    }

    const promptLength = body.prompt?.length || 0;
    if (promptLength > MAX_CONTENTS_TEXT_LENGTH) {
        return { status: 413, error: 'Contents text is too long.' };
    }

    let textLength = 0;
    let contents = body.contents;
    if (contents === undefined && body.prompt?.trim()) {
        contents = [{ role: 'user', parts: [{ text: body.prompt.trim() }] }];
    }
    if (!Array.isArray(contents) || !contents.length) {
        return { status: 400, error: 'Contents must be a non-empty array or supplied via prompt.' };
    }
    if (contents.length > MAX_CONTENTS_ITEMS) {
        return { status: 413, error: 'Too many contents items.' };
    }

    const payload = { contents: [] };
    let totalParts = 0;
    for (const item of contents) {
        if (!isPlainObject(item) || !Array.isArray(item.parts) || !item.parts.length
            || (item.role !== undefined && typeof item.role !== 'string')) {
            return { status: 400, error: 'Each contents item must have a non-empty parts array and an optional string role.' };
        }
        totalParts += item.parts.length;
        if (item.parts.length > MAX_PARTS_PER_ITEM || totalParts > MAX_TOTAL_PARTS) {
            return { status: 413, error: 'Too many contents parts.' };
        }

        const normalizedItem = { parts: [] };
        if (item.role !== undefined) normalizedItem.role = item.role;
        for (const part of item.parts) {
            if (!isTextPart(part)) return { status: 400, error: 'Only text parts are supported.' };
            textLength += part.text.length;
            if (textLength > MAX_CONTENTS_TEXT_LENGTH) {
                return { status: 413, error: 'Contents text is too long.' };
            }
            normalizedItem.parts.push({ text: part.text });
        }
        payload.contents.push(normalizedItem);
    }

    const instruction = body.systemInstruction;
    if (instruction !== undefined) {
        const parts = typeof instruction === 'string' ? [{ text: instruction }]
            : isPlainObject(instruction) ? instruction.parts : undefined;
        if (!Array.isArray(parts) || !parts.length) {
            return { status: 400, error: 'System instruction must be a string or contain a non-empty text parts array.' };
        }

        let instructionLength = 0;
        const normalizedParts = [];
        for (const part of parts) {
            if (!isTextPart(part)) return { status: 400, error: 'System instruction supports only text parts.' };
            instructionLength += part.text.length;
            if (instructionLength > MAX_SYSTEM_INSTRUCTION_LENGTH) {
                return { status: 413, error: 'System instruction is too long.' };
            }
            normalizedParts.push({ text: part.text });
        }
        payload.systemInstruction = { parts: normalizedParts };
    }
    return { payload };
}

module.exports = async function handler(req, res) {
    const origin = req.headers.origin;
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Origin');

    if (!allowedOrigin(req)) return clientError(res, 403, 'Origin not allowed.');
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'POST') {
        return clientError(res, 405, 'Method Not Allowed. Use POST.');
    }

    if (rateLimited(req)) return clientError(res, 429, 'Quá nhiều yêu cầu. Vui lòng thử lại sau.');

    const contentLength = req.headers['content-length'];
    if (/^\d+$/.test(contentLength) && Number(contentLength) > MAX_BODY_BYTES) {
        return clientError(res, 413, 'Request body is too large.');
    }

    let body;
    try {
        const rawBody = req.body;
        if (typeof rawBody === 'string' && Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
            return clientError(res, 413, 'Request body is too large.');
        }
        body = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
        const serialized = JSON.stringify(body);
        if (serialized !== undefined && Buffer.byteLength(serialized, 'utf8') > MAX_BODY_BYTES) {
            return clientError(res, 413, 'Request body is too large.');
        }
    } catch {
        return clientError(res, 400, 'Invalid JSON body.');
    }

    const { payload, status, error } = validatePayload(body);
    if (status) return clientError(res, status, error);

    const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) return clientError(res, 500, 'Server configuration is missing GEMINI_API_KEY.');

    try {
        const rawModel = String(body.model || DEFAULT_MODEL).trim();
        const model = ALLOWED_MODELS.has(rawModel) ? rawModel : DEFAULT_MODEL;

        if (body.generationConfig && typeof body.generationConfig === 'object') {
            const generationConfig = { ...body.generationConfig };
            const requestedTokens = Number(generationConfig.maxOutputTokens);
            generationConfig.maxOutputTokens = Number.isFinite(requestedTokens)
                ? Math.min(4096, Math.max(1, requestedTokens)) : 4096;
            payload.generationConfig = generationConfig;
        }

        const candidateModels = [...new Set([model, ...FALLBACK_MODELS])].slice(0, MAX_MODEL_ATTEMPTS);

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
