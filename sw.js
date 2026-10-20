// Change the version when the offline shell format or fixed public assets change.
const CACHE_NAME = 'rijin-pwa-v7'
const CACHE_PREFIX = 'rijin-pwa-'
const OFFLINE_SHELL = '/'
const PUBLIC_ASSETS = ['/manifest.webmanifest', '/icon-192.png', '/icon-512.png']
const EXERCISE_MANIFEST = '/exercise-art/index.json'

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // Read the built HTML so the exact Vite asset hashes are available offline.
    const shell = await fetch(OFFLINE_SHELL, { cache: 'reload' })
    if (!shell.ok) throw new Error('Unable to cache the app shell')

    const html = await shell.clone().text()
    const builtAssets = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)]
      .map((match) => match[1])
    const cache = await caches.open(CACHE_NAME)
    await cache.put(OFFLINE_SHELL, shell)
    await cache.addAll([...new Set([...PUBLIC_ASSETS, ...builtAssets])])
    // Keep the small, curated movement art usable in an installed offline app.
    // A missing optional image must not prevent the app shell from installing.
    try {
      const response = await fetch(EXERCISE_MANIFEST, { cache: 'reload' })
      if (response.ok) {
        await cache.put(EXERCISE_MANIFEST, response.clone())
        const assets = await response.json()
        if (Array.isArray(assets)) {
          const paths = assets.filter((value) => typeof value === 'string' && /^\/exercise-art\/[a-z0-9-]+\/frame-[123]\.svg$/.test(value))
          for (let index = 0; index < paths.length; index += 10) {
            await Promise.allSettled(paths.slice(index, index + 10).map((asset) => cache.add(asset)))
          }
        }
      }
    } catch {
      // The rest of the app remains available offline.
    }
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: 'reload' })
        if (response.ok) {
          try {
            const cache = await caches.open(CACHE_NAME)
            await cache.put(OFFLINE_SHELL, response.clone())
          } catch {
            // A full or unavailable cache must not block a successful navigation.
          }
        }
        return response
      } catch {
        return (await caches.match(OFFLINE_SHELL)) || Response.error()
      }
    })())
    return
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/exercise-art/')) {
    event.respondWith((async () => {
      const cached = await caches.match(request, { ignoreVary: true })
      if (cached) return cached
      const response = await fetch(request)
      if (response.ok) {
        try {
          const cache = await caches.open(CACHE_NAME)
          await cache.put(request, response.clone())
        } catch {
          // Serve the network response even if this asset cannot be stored.
        }
      }
      return response
    })())
    return
  }

  if (PUBLIC_ASSETS.includes(url.pathname)) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request)
        if (response.ok) {
          try {
            const cache = await caches.open(CACHE_NAME)
            await cache.put(request, response.clone())
          } catch {
            // Keep icons and the manifest usable online when storage is full.
          }
        }
        return response
      } catch {
        return (await caches.match(request, { ignoreVary: true })) || Response.error()
      }
    })())
  }
})
