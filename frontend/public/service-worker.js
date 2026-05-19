/* eslint-disable no-restricted-globals */
const CACHE_NAME = 'voxly-shell-v2';
const DB_NAME = 'voxly-offline';
const DB_VERSION = 1;
const STORE_NAME = 'pending_expenses';
const APP_SHELL = ['/', '/app', '/index.html', '/manifest.json'];

// ─── IndexedDB helpers ────────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE_NAME, {
        keyPath: 'id',
        autoIncrement: true,
      });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function queueExpense(payload) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add({
      payload,
      queuedAt: new Date().toISOString(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function getPendingExpenses() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function deleteQueuedExpense(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

// ─── Sync pending expenses to the server ─────────────────────────────────────

async function syncPendingExpenses() {
  const pending = await getPendingExpenses();
  if (!pending.length) return;

  let synced = 0;
  for (const entry of pending) {
    try {
      const resp = await fetch('/api/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(entry.payload),
      });
      if (resp.ok) {
        await deleteQueuedExpense(entry.id);
        synced++;
      }
    } catch (_) {
      // Still offline — leave in queue
      break;
    }
  }

  if (synced > 0) {
    // Notify all open tabs
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((client) =>
      client.postMessage({ type: 'SYNC_COMPLETE', count: synced })
    );
  }
}

// ─── Install / Activate ───────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => Promise.resolve())
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
        )
      )
  );
  self.clients.claim();
});

// ─── Fetch handler ────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Intercept POST /api/add when offline
  if (request.method === 'POST' && url.pathname === '/api/add') {
    event.respondWith(
      fetch(request.clone())
        .then((resp) => {
          // Online — flush any queued expenses opportunistically
          syncPendingExpenses();
          return resp;
        })
        .catch(async () => {
          // Offline — queue the expense
          try {
            const body = await request.json();
            await queueExpense(body);
            return new Response(
              JSON.stringify({
                message: 'Saved offline. Will sync when connection is restored.',
                offline: true,
              }),
              {
                status: 202,
                headers: { 'Content-Type': 'application/json' },
              }
            );
          } catch (err) {
            return new Response(
              JSON.stringify({ error: 'Failed to queue expense offline.' }),
              { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
          }
        })
    );
    return;
  }

  // API requests: network-first with no caching
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request)
          .then((resp) => {
            if (resp.status === 200 && resp.type === 'basic') {
              const clone = resp.clone();
              caches.open(CACHE_NAME).then((c) => c.put(request, clone));
            }
            return resp;
          })
          .catch(() => caches.match('/app'))
    )
  );
});

// ─── Background sync (when browser supports it) ───────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-expenses') {
    event.waitUntil(syncPendingExpenses());
  }
});

// ─── Manual sync trigger from app ────────────────────────────────────────────

self.addEventListener('message', (event) => {
  if (event.data?.type === 'TRIGGER_SYNC') {
    syncPendingExpenses();
  }
});
