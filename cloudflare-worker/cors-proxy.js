/**
 * CORS Proxy for Fun-da
 * Deploy this to Cloudflare Workers at: https://dash.cloudflare.com/
 * 
 * Usage: https://your-worker.workers.dev/?url=https://www.funda.nl/...
 * 
 * Setup:
 * 1. Go to https://dash.cloudflare.com/
 * 2. Click "Workers & Pages" in the sidebar
 * 3. Click "Create application" → "Create Worker"
 * 4. Replace the default code with this file's contents
 * 5. Click "Save and Deploy"
 * 6. Update the proxy URL in scraper.js
 */

// Allowed origins (add your domains here)
const ALLOWED_ORIGINS = [
    'https://my-pwa-apps.github.io',
    'http://localhost:8000',
    'http://localhost:3000',
    'http://127.0.0.1:8000',
];

// Blocked URL patterns (security)
const BLOCKED_PATTERNS = [
    /^https?:\/\/localhost/i,
    /^https?:\/\/127\./i,
    /^https?:\/\/192\.168\./i,
    /^https?:\/\/10\./i,
    /^https?:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\./i,
];

export default {
    async fetch(request, env, ctx) {
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return handleCORS(request);
        }

        const url = new URL(request.url);
        const targetUrl = url.searchParams.get('url');

        // Validate request
        if (!targetUrl) {
            return new Response(JSON.stringify({
                error: 'Missing url parameter',
                usage: 'Add ?url=https://example.com to fetch a URL'
            }), {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    ...getCORSHeaders(request)
                }
            });
        }

        // Check if URL is blocked (security)
        for (const pattern of BLOCKED_PATTERNS) {
            if (pattern.test(targetUrl)) {
                return new Response(JSON.stringify({
                    error: 'URL not allowed'
                }), {
                    status: 403,
                    headers: {
                        'Content-Type': 'application/json',
                        ...getCORSHeaders(request)
                    }
                });
            }
        }

        try {
            // Detect Funda's internal mobile API (*.funda.io) - use mobile app headers
            const isFundaAPI = /\.funda\.io\//.test(targetUrl);

            let fetchConfig;
            if (isFundaAPI) {
                // Use Funda Android app headers for the mobile API
                fetchConfig = {
                    method: request.method,
                    headers: {
                        'user-agent': 'Dart/3.9 (dart:io)',
                        'x-funda-app-platform': 'android',
                        'content-type': 'application/json',
                        'accept': 'application/json',
                        'accept-encoding': 'gzip',
                        'referer': 'https://www.funda.nl/',
                    },
                    redirect: 'follow',
                };
                // Forward the request body for POST (search API uses POST with NDJSON)
                if (request.method === 'POST') {
                    fetchConfig.body = request.body;
                }
            } else {
                // Randomize User-Agent to avoid fingerprinting for regular HTML scraping
                const userAgents = [
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
                ];
                const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
                fetchConfig = {
                    method: request.method,
                    headers: {
                        'User-Agent': randomUA,
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                        'Accept-Language': 'nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Cache-Control': 'max-age=0',
                        'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
                        'Sec-Ch-Ua-Mobile': '?0',
                        'Sec-Ch-Ua-Platform': '"Windows"',
                        'Sec-Fetch-Dest': 'document',
                        'Sec-Fetch-Mode': 'navigate',
                        'Sec-Fetch-Site': 'none',
                        'Sec-Fetch-User': '?1',
                        'Upgrade-Insecure-Requests': '1',
                        'Referer': 'https://www.google.nl/',
                    },
                    redirect: 'follow',
                };
            }

            // Fetch the target URL
            const response = await fetch(targetUrl, fetchConfig);

            // Get the response body
            const body = await response.text();

            // Return with CORS headers
            return new Response(body, {
                status: response.status,
                statusText: response.statusText,
                headers: {
                    'Content-Type': response.headers.get('Content-Type') || 'text/html',
                    'X-Proxy-Status': response.status.toString(),
                    'X-Original-URL': targetUrl,
                    ...getCORSHeaders(request)
                }
            });

        } catch (error) {
            return new Response(JSON.stringify({
                error: 'Failed to fetch URL',
                message: error.message,
                url: targetUrl
            }), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    ...getCORSHeaders(request)
                }
            });
        }
    }
};

function getCORSHeaders(request) {
    const origin = request.headers.get('Origin') || '*';
    
    // Check if origin is allowed (or allow all for development)
    const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    
    return {
        'Access-Control-Allow-Origin': '*', // Use '*' for easy testing, restrict in production
        'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
        'Access-Control-Max-Age': '86400',
    };
}

function handleCORS(request) {
    return new Response(null, {
        status: 204,
        headers: getCORSHeaders(request)
    });
}
