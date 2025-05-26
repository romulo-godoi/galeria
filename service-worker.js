/**
 * Service Worker para o aplicativo Registro de Campo (Firebase)
 *
 * Responsável por cachear os recursos essenciais do aplicativo para
 * permitir o funcionamento offline (Progressive Web App - PWA).
 * Utiliza a biblioteca Workbox para simplificar algumas tarefas de cache.
 */

// Importa a biblioteca Workbox do CDN do Google
importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.4.1/workbox-sw.js'); // Versão atualizada do Workbox

// Define um nome único para o cache. Mude este nome sempre que
// atualizar os arquivos do Service Worker para forçar a atualização do cache.
const CACHE_NAME = 'registro-campo-firebase-cache-v1.5'; // Nome atualizado

// Página HTML principal que será servida como fallback offline para navegação.
const offlineFallbackPage = './index.html'; // Ou o nome do seu arquivo HTML principal

// Lista de URLs dos arquivos essenciais do aplicativo para cachear na instalação.
const urlsToCache = [
  './', // Cacheia a raiz (geralmente redireciona para index.html)
  offlineFallbackPage, // Garante que a página principal esteja cacheada
  './manifest.json', // Arquivo de manifesto do PWA
  // Ícones do PWA (adicione outros tamanhos se tiver)
  './icon-192x192.png',
  './icon-512x512.png',
  // Dependências externas (CDNs)
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  // <<< NOVO: URLs dos módulos Firebase SDK >>>
  // É crucial cachear os SDKs para que o app possa tentar inicializar o Firebase offline
  // (embora operações de escrita ainda falhem offline, a leitura pode funcionar do cache do Firebase se habilitado)
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js',
  // <<< FIM NOVO >>>
];

// --- Event Listeners do Ciclo de Vida do Service Worker ---

// Evento 'install': Acionado quando o SW é instalado pela primeira vez.
// Cacheia todos os arquivos listados em urlsToCache.
self.addEventListener('install', (event) => {
  console.log(`SW (${CACHE_NAME}): Evento install`);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log(`SW (${CACHE_NAME}): Cache aberto. Cacheando arquivos iniciais...`);
        // Garante que não haja duplicatas e adiciona todos ao cache
        const allUrlsToCache = [...new Set([...urlsToCache])];
        return cache.addAll(allUrlsToCache);
      })
      .then(() => {
        console.log(`SW (${CACHE_NAME}): Arquivos iniciais cacheados com sucesso.`);
        // Força o SW instalado a se tornar ativo imediatamente (útil para atualizações)
        // self.skipWaiting(); // Descomente se quiser ativação imediata após instalação
      })
      .catch(error => {
        console.error(`SW (${CACHE_NAME}): Falha ao cachear arquivos na instalação:`, error);
      })
  );
});

// Evento 'activate': Acionado quando o SW se torna ativo.
// É um bom lugar para limpar caches antigos que não são mais necessários.
self.addEventListener('activate', (event) => {
  console.log(`SW (${CACHE_NAME}): Evento activate`);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Deleta qualquer cache que não seja o cache atual (CACHE_NAME)
          if (cacheName !== CACHE_NAME) {
            console.log(`SW (${CACHE_NAME}): Deletando cache antigo: ${cacheName}`);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log(`SW (${CACHE_NAME}): Caches antigos limpos.`);
      // Permite que o SW ativo controle clientes (abas) imediatamente sem precisar recarregar.
      return self.clients.claim();
    })
  );
});

// Mensagem para forçar o SW a pular a fase de espera (útil para atualizações)
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    console.log(`SW (${CACHE_NAME}): Recebido comando SKIP_WAITING.`);
    self.skipWaiting();
  }
});

// --- Estratégias de Cache com Workbox (ou manualmente) ---

// Habilita o Navigation Preload se suportado (melhora performance em alguns casos)
if (workbox.navigationPreload && workbox.navigationPreload.isSupported()) {
  try {
      workbox.navigationPreload.enable();
      console.log(`SW (${CACHE_NAME}): Navigation Preload habilitado.`);
  } catch(e) {
      console.error('SW: Falha ao habilitar Navigation Preload:', e);
  }
}

// Evento 'fetch': Intercepta todas as requisições de rede feitas pela página.
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Ignora requisições que não são GET ou de extensões do Chrome
  if (event.request.method !== 'GET' || url.startsWith('chrome-extension://')) {
    return;
  }

  // Estratégia para requisições de navegação (ex: carregar o HTML principal)
  // Tenta a rede primeiro, se falhar, usa o cache (NetworkFirst com fallback).
  // Usa a página principal (offlineFallbackPage) como fallback final.
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        // Tenta usar a resposta pré-carregada (Navigation Preload)
        const preloadResponse = await event.preloadResponse;
        if (preloadResponse) {
          console.log(`SW (${CACHE_NAME}): Usando preload response para ${url}`);
          return preloadResponse;
        }

        // Tenta buscar da rede
        const networkResponse = await fetch(event.request);
        console.log(`SW (${CACHE_NAME}): Buscando da rede (navigate): ${url}`);

        // Se a resposta da rede for válida, clona e guarda no cache
        if (networkResponse && networkResponse.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(event.request, networkResponse.clone());
        }
        return networkResponse;

      } catch (error) {
        // Se a rede falhar (offline)
        console.warn(`SW (${CACHE_NAME}): Rede falhou para navegação (${url}). Tentando cache...`);
        const cache = await caches.open(CACHE_NAME);
        // Tenta encontrar a requisição original no cache
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) {
            console.log(`SW (${CACHE_NAME}): Servindo do cache (navigate): ${url}`);
            return cachedResponse;
        }
        // Se não encontrar a requisição original, serve a página de fallback
        console.warn(`SW (${CACHE_NAME}): Servindo fallback offline para ${url}`);
        const fallbackResponse = await cache.match(offlineFallbackPage);
        return fallbackResponse || new Response("Você está offline. Página não disponível.", {
          status: 404,
          headers: { 'Content-Type': 'text/html' } // Retorna HTML no fallback
        });
      }
    })());
  }
  // Estratégia para outros recursos (CSS, JS, Imagens, Fontes, CDNs)
  // Cache First: Tenta servir do cache primeiro. Se não encontrar, busca na rede
  // e atualiza o cache para a próxima vez.
  else {
    event.respondWith(
      caches.match(event.request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            // Encontrado no cache, retorna imediatamente
            // console.log(`SW (${CACHE_NAME}): Servindo do cache: ${url}`); // Log opcional (pode ser verboso)
            return cachedResponse;
          }

          // Não encontrado no cache, busca na rede
          // console.log(`SW (${CACHE_NAME}): Buscando da rede (recurso): ${url}`); // Log opcional
          return fetch(event.request).then(
            (networkResponse) => {
              // Verifica se a resposta da rede é válida
              if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'error') {
                console.warn(`SW (${CACHE_NAME}): Resposta inválida da rede para ${url}. Status: ${networkResponse?.status}`);
                return networkResponse; // Retorna a resposta inválida (ou erro)
              }

              // Clona a resposta válida para poder guardá-la no cache e retorná-la
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME)
                .then((cache) => {
                  // console.log(`SW (${CACHE_NAME}): Cacheando recurso da rede: ${url}`); // Log opcional
                  cache.put(event.request, responseToCache);
                });
              return networkResponse; // Retorna a resposta da rede
            }
          ).catch(error => {
            // Erro ao buscar na rede (offline e sem cache)
            console.error(`SW (${CACHE_NAME}): Fetch falhou (rede e cache indisponível): ${url}`, error);
            // Retorna uma resposta de erro apropriada
            // Pode retornar respostas diferentes dependendo do tipo de recurso (imagem placeholder, etc.)
            // if (event.request.destination === 'image') { /* retorna placeholder */ }
            return new Response(`Recurso indisponível offline: ${url}`, {
              status: 404,
              headers: { 'Content-Type': 'text/plain' },
            });
          });
        })
    );
  }
});

console.log(`Service Worker (${CACHE_NAME}) carregado e pronto.`);

