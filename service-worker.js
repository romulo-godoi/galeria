// service-worker.js
const CACHE_NAME = 'jw-assignments-cache-v2.7'; // Versão incrementada
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.2.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.2.0/webfonts/fa-solid-900.woff2',
];

self.addEventListener('install', (event) => {
  console.log(`SW (${CACHE_NAME}): Instalando...`);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log(`SW (${CACHE_NAME}): Cache aberto, adicionando App Shell:`, urlsToCache);
        const cachePromises = urlsToCache.map(urlToCache => {
          const requestOptions = urlToCache.includes('googleapis.com') ? { cache: 'no-cache', mode: 'cors' } : { cache: 'no-cache' };
          return fetch(new Request(urlToCache, requestOptions))
            .then(response => {
              if (!response.ok) {
                 if (response.status !== 0 && response.type !== 'opaque') { // Permite respostas opacas (CORS)
                    console.error(`SW (${CACHE_NAME}): Falha ao buscar ${urlToCache} durante a instalação: ${response.status} ${response.statusText}`);
                    throw new Error(`Falha ao buscar ${urlToCache}: ${response.status} ${response.statusText}`);
                 }
              }
               const responseToCache = response.clone();
              return cache.put(urlToCache, responseToCache);
            })
            .catch(err => {
              console.error(`SW (${CACHE_NAME}): Erro crítico ao cachear ${urlToCache} na instalação:`, err);
              throw err; // Falha a instalação se um asset essencial não puder ser cacheado
            });
        });
        return Promise.all(cachePromises);
      })
      .then(() => {
        console.log(`SW (${CACHE_NAME}): App Shell cacheado com sucesso.`);
        return self.skipWaiting(); // Ativa o novo SW imediatamente
      })
      .catch(error => {
        console.error(`SW (${CACHE_NAME}): Falha GERAL ao cachear na instalação. Instalação abortada. Erro:`, error);
        // A instalação falhou, o SW antigo (se houver) permanecerá ativo.
      })
  );
});

self.addEventListener('activate', (event) => {
  console.log(`SW (${CACHE_NAME}): Ativando...`);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log(`SW (${CACHE_NAME}): Removendo cache antigo:`, cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log(`SW (${CACHE_NAME}): Ativado e caches antigos removidos.`);
      return self.clients.claim(); // Controla clientes abertos imediatamente
    })
  );
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // Ignorar requisições não-GET e extensões do Chrome
  if (event.request.method !== 'GET' || requestUrl.protocol === 'chrome-extension:') {
    return;
  }

  // Ignorar requisições para SDKs Firebase (módulos ES6) e Realtime Database
  if (requestUrl.origin === 'https://www.gstatic.com' && requestUrl.pathname.startsWith('/firebasejs/')) {
    // console.log(`SW (${CACHE_NAME}): Ignorando requisição SDK Firebase: ${event.request.url}`);
    return; // Deixa o navegador/módulo lidar
  }
  if (requestUrl.hostname.endsWith('firebaseio.com')) {
    // console.log(`SW (${CACHE_NAME}): Ignorando requisição Firebase DB: ${event.request.url}`);
    return; // Deixa a SDK do Firebase lidar
  }

  // Estratégia: Cache Only (para o App Shell pré-cacheado)
  const isCoreAsset = urlsToCache.some(url => {
    // Normaliza URLs para comparação, especialmente para './' e './index.html'
    const absoluteUrlToCache = new URL(url, self.location.origin).href;
    return requestUrl.href === absoluteUrlToCache;
  });


  if (isCoreAsset) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          // console.log(`SW (${CACHE_NAME}): Servindo App Shell do cache: ${event.request.url}`);
          return cachedResponse;
        } else {
          // Isso não deveria acontecer se a instalação foi bem sucedida
          console.error(`SW (${CACHE_NAME}): Asset principal ${event.request.url} NÃO encontrado no cache! Tentando rede.`);
          // Como fallback, tentar a rede (e talvez recachear se der certo)
          return fetch(event.request).then(networkResponse => {
              if (networkResponse && networkResponse.ok) {
                  const responseToCache = networkResponse.clone();
                  caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
              }
              return networkResponse;
          }).catch(err => {
               console.error(`SW (${CACHE_NAME}): Falha na rede ao buscar asset principal ${event.request.url} ausente do cache:`, err);
               // Retorna uma resposta de erro genérica se a rede falhar também
               return new Response("Erro: Recurso essencial indisponível.", { status: 503, statusText: "Service Unavailable", headers: { 'Content-Type': 'text/plain' } });
          });
        }
      })
    );
  } else {
    // Estratégia: Network Falling Back to Cache (para outros recursos, como fontes carregadas pelo CSS)
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          // Resposta da rede OK (ou opaca, como fontes de CDNs)
          if (networkResponse && (networkResponse.ok || networkResponse.type === 'opaque')) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });
          }
          // Retorna a resposta da rede (mesmo se não for .ok, para que o browser lide com o erro)
          return networkResponse;
        })
        .catch(() => {
          // Falha na rede (offline?)
          // console.log(`SW (${CACHE_NAME}): Rede falhou para ${event.request.url}, tentando cache.`);
          return caches.match(event.request)
            .then((cachedResponse) => {
              if (cachedResponse) {
                // console.log(`SW (${CACHE_NAME}): Servindo fallback do cache: ${event.request.url}`);
                return cachedResponse;
              }
              // Sem rede e sem cache
              console.warn(`SW (${CACHE_NAME}): Sem cache e sem rede para: ${event.request.url}`);
              // Retorna uma resposta genérica de erro offline
              // Evitar retornar erro para requisições de fontes, pois o navegador pode ter fallbacks
              if (event.request.destination !== 'font') {
                  return new Response("Network error: Resource not available offline.", {
                      status: 408, // Request Timeout or use 503 Service Unavailable
                      headers: { 'Content-Type': 'text/plain' }
                  });
              }
              // Para fontes, não retorna erro, deixa o navegador tentar fallbacks
              return new Response('', {status: 404, statusText: 'Not Found'});
            });
        })
    );
  }
});

