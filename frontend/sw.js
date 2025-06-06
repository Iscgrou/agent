// Service Worker
self.addEventListener('install', event => {
    console.log('Service Worker installed');
});

self.addEventListener('activate', event => {
    console.log('Service Worker activated');
});

self.addEventListener('fetch', event => {
    event.respondWith(
        fetch(event.request)
            .catch(() => {
                // Return a fallback response for offline functionality
                return new Response('Offline content here', {
                    headers: { 'Content-Type': 'text/plain' }
                });
            })
    );
});
