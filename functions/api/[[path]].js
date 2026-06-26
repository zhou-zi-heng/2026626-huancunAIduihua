export async function onRequest(context) {
    const { request } = context;

    // 处理预检请求
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': '*',
                'Access-Control-Max-Age': '86400',
            }
        });
    }

    // 从请求头获取目标 API 地址
    const targetBase = request.headers.get('X-Target-Base');
    if (!targetBase) {
        return new Response(JSON.stringify({ error: 'Missing X-Target-Base header' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }

    // 提取子路径：/api/models → models，/api/v1/messages → v1/messages
    const url = new URL(request.url);
    const subPath = url.pathname.replace(/^\/api\//, '');
    const targetUrl = targetBase.replace(/\/+$/, '') + '/' + subPath + url.search;

    // 转发请求头（过滤掉 Cloudflare 内部头 + 我们的控制头）
    const headers = new Headers();
    const skipHeaders = [
        'host', 'cf-connecting-ip', 'cf-ray', 'cf-visitor', 'cf-worker',
        'cf-ipcountry', 'cf-ew-via', 'x-target-base',
        'content-length', // 让 fetch 自动计算
    ];
    for (const [key, value] of request.headers) {
        if (!skipHeaders.includes(key.toLowerCase())) {
            headers.set(key, value);
        }
    }

    // ★ Anthropic 原生协议：浏览器直连需要这个头（中转站一般也认）
    //   如果客户端没传 anthropic-version，且看起来是 anthropic 调用，补一个默认值
    const isAnthropicPath = /\/messages\b/.test(targetUrl) || /anthropic/i.test(targetBase);
    if (isAnthropicPath && !headers.has('anthropic-version')) {
        headers.set('anthropic-version', '2023-06-01');
    }

    try {
        const resp = await fetch(targetUrl, {
            method: request.method,
            headers: headers,
            body: (request.method !== 'GET' && request.method !== 'HEAD') ? request.body : undefined,
        });

        // 返回响应（流式 body 直接透传）
        const newHeaders = new Headers(resp.headers);
        newHeaders.set('Access-Control-Allow-Origin', '*');
        newHeaders.set('Access-Control-Expose-Headers', '*');

        return new Response(resp.body, {
            status: resp.status,
            statusText: resp.statusText,
            headers: newHeaders,
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: 'Proxy failed: ' + e.message }), {
            status: 502,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }
}