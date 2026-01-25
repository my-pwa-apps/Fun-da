const CACHE_NAME = 'fun-da-v3';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/css/styles.css',
    '/js/app.js',
    '/js/data.js',
    '/js/scraper.js',
    '/js/firebase-sync.js',
    '/manifest.json',
    '/icons/icon-192.svg',
    '/favicon.svg'
];

// Install event - cache assets
self.addEventListener('install', (event) => {
    console.log('🏠 Fun-da: Installing service worker...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('🏠 Fun-da: Caching assets...');
                return cache.addAll(ASSETS_TO_CACHE);
            })
            .then(() => {
                console.log('🎉 Fun-da: Assets cached successfully!');
                return self.skipWaiting();
            })
            .catch((error) => {
                console.error('❌ Fun-da: Failed to cache assets:', error);
            })
    );
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => name !== CACHE_NAME)
                        .map((name) => {
                            console.log('🧹 Fun-da: Deleting old cache:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => {
                console.log('✅ Fun-da: Service Worker activated!');
                return self.clients.claim();
            })
    );
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Skip external requests (CORS proxies, Firebase, etc.)
    const url = new URL(event.request.url);
    if (url.origin !== location.origin) return;

    // Network first strategy for all requests
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Cache successful responses
                if (response && response.ok) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return response;
            })
            .catch(() => {
                // Fallback to cache
                return caches.match(event.request).then(cached => {
                    if (cached) {
                        return cached;
                    }
                    // Return proper 404 for missing resources
                    return new Response('Not found', { 
                        status: 404, 
                        statusText: 'Not Found',
                        headers: { 'Content-Type': 'text/plain' }
                    });
                });
            })
    );
});
