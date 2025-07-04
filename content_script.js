// content_script.js - Refactored for Robustness (Button Fix v1.8.5, Enhanced SPA Handling v2.5)
(function() {
    'use strict';

    // --- Configuration and Constants ---
    const SCRIPT_VERSION = "2.5 - Enhanced SPA Handling"; // << UPDATED VERSION >>
    console.log(`Extension Image Gallery Preview (v${SCRIPT_VERSION}) Activated!`);

    const PERSISTENT_THUMB_CACHE_KEY = 'cgThumbUrlCache_v1';
    const CACHE_DURATION_MS = 48 * 60 * 60 * 1000; // 48 hours
    const FETCH_DELAY_MS = 700;
    const DEBOUNCE_PROCESS_QUEUE_MS = 100;
    const IMAGE_LOAD_TRANSITION_MS = 50;
    const THUMBNAIL_SIZE_PX = 180;

    const SELECTORS = {
        topicLink: 'a.raw-topic-link',
        topicRow: 'tr',
        topicCell: 'td.main-link, td.topic-list-data.title, td:has(a.raw-topic-link)',
        otherCells: 'td:not(.main-link):not(.topic-list-data.title):not(:has(a.raw-topic-link))',
        topicTitleLink: 'a.raw-topic-link',
        topicMetaData: '.topic-list-item-meta, .topic-creator',
        topicTagsContainer: '.topic-list-tags',
        avatarImage: 'img.avatar',
        preloadedData: '#data-preloaded',
        mainOutlet: '#main-outlet', // Key element for SPA navigation changes
        galleryImageLink: 'a.lightbox img',
        galleryImageFallback: 'img',
        firstPostCookedContent: '.post-stream .topic-post:first-child .cooked',
    };

    const CSS_CLASSES = {
        galleryOverlay: 'cg-gallery-overlay',
        galleryVisible: 'cg-visible',
        galleryStatus: 'cg-gallery-status',
        galleryPrev: 'cg-gallery-prev',
        galleryImage: 'cg-gallery-image',
        galleryNext: 'cg-gallery-next',
        galleryClose: 'cg-gallery-close',
        galleryDownload: 'cg-gallery-download',
        topicPreviewContainer: 'topic-preview-container',
        topicPreviewThumbnail: 'topic-preview-thumbnail',
        topicPreviewPlaceholder: 'topic-preview-placeholder',
        topicPreviewLoading: 'topic-preview-loading',
    };

    const UI_TEXTS = {
        galleryTitle: 'Open topic image gallery',
        galleryLoading: 'Loading images...',
        galleryLoadingFetch: 'Fetching data...',
        galleryLoadingHQ: 'Preparing images...',
        galleryNoImages: 'No images found in the initial post.',
        galleryDownloadButtonTitle: 'Download current image (Shortcut: S)',
        galleryDownloadOk: 'Downloading...',
        galleryDownloadErr: 'Download Error!',
        galleryDownloadWarn: 'Nothing to download!',
        placeholderLoading: '⏳',
        placeholderError: 'Error. Click to try opening.',
        placeholderNoImages: 'No image. Click to open.',
        placeholderDefault: 'Click to open gallery.',
        placeholderNoId: 'Preview unavailable (no ID)',
        placeholderSymbolError: '⚠️',
        placeholderSymbolView: '👁️',
        placeholderSymbolNoId: '🚫',
        arrowPrev: '‹',
        arrowNext: '›',
        closeButton: '×',
        downloadButton: '⬇',
        galleryImageAlt: "Gallery Image",
        thumbnailAlt: 'Topic Preview',
        placeholderSymbolLoading: '⏳'
    };

    let initialImageMap = null;
    const topicImageCache = {};
    let activeGallery = { topicId: null, images: [], currentIndex: -1, topicTitle: null, opUsername: null };
    const fetchPreviewQueue = [];
    let isPreviewQueueProcessing = false;
    let processQueueTimeoutId = null;
    let mutationObserver = null;
    let galleryOverlay = null, galleryImage = null, galleryPrevBtn = null, galleryNextBtn = null, galleryCloseBtn = null, galleryStatus = null, galleryDownloadBtn = null;

    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    function getTopicIdFromUrl(url) { const match = url?.match(/\/t\/(?:[^\/]+\/)?(\d+)(?:[\/?#]|$)/); return (match && match[1]) ? `t${match[1]}` : null; }
    function logError(context, ...args) { console.error(`[GalleryPreview ${SCRIPT_VERSION} Error - ${context}]`, ...args); }
    function logWarn(context, ...args) { console.warn(`[GalleryPreview ${SCRIPT_VERSION} Warn - ${context}]`, ...args); }
    function logInfo(context, ...args) { console.log(`[GalleryPreview ${SCRIPT_VERSION} Info - ${context}]`, ...args); }

    function injectStyles() {
        const styleId = 'cg-gallery-dynamic-styles';
        if (document.getElementById(styleId)) return;
        const galleryButtonSize = 50; const galleryNavFontSize = 28; const galleryActionFontSize = 24; const galleryDownloadBtnRightPos = galleryButtonSize + 25;
        const css = `
            ${SELECTORS.topicCell} { display: flex !important; flex-direction: column !important; align-items: center !important; justify-content: flex-start; padding: 20px 10px 15px 10px !important; }
            ${SELECTORS.otherCells} { vertical-align: middle !important; }
            .${CSS_CLASSES.topicPreviewContainer} { display: block; width: ${THUMBNAIL_SIZE_PX}px; height: ${THUMBNAIL_SIZE_PX}px; margin: 0 auto 15px auto; cursor: default; flex-shrink: 0; border-radius: 10px; position: relative; overflow: hidden; transition: box-shadow 0.2s ease-out; background-color: #f0f0f0; }
            .${CSS_CLASSES.topicPreviewContainer}:not(.${CSS_CLASSES.topicPreviewLoading}) { box-shadow: 0 4px 10px rgba(0,0,0,0.12); }
            .${CSS_CLASSES.topicPreviewContainer}[data-clickable="true"] { cursor: pointer; }
            .${CSS_CLASSES.topicPreviewContainer}[data-clickable="true"]:hover { box-shadow: 0 7px 18px rgba(0,0,0,0.18); }
            .${CSS_CLASSES.topicPreviewContainer}.${CSS_CLASSES.topicPreviewLoading} { background-color: #e8e8e8; display: flex; align-items: center; justify-content: center; box-shadow: none; }
            .${CSS_CLASSES.topicPreviewThumbnail} { width: 100%; height: 100%; object-fit: cover; display: block; border: none; transition: transform 0.25s ease-out; border-radius: inherit; }
            .${CSS_CLASSES.topicPreviewContainer}[data-clickable="true"]:hover .${CSS_CLASSES.topicPreviewThumbnail} { transform: scale(1.04); }
            .${CSS_CLASSES.topicPreviewPlaceholder} { font-size: ${THUMBNAIL_SIZE_PX * 0.25}px; display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; line-height: 1; user-select: none; color: #b0b0b0; background-color: transparent; border-radius: inherit; }
            .${CSS_CLASSES.topicPreviewContainer}:not(.${CSS_CLASSES.topicPreviewLoading}) .${CSS_CLASSES.topicPreviewPlaceholder}{ background-color: #f7f7f7; border: 1px dashed #ccc; }
            .${CSS_CLASSES.topicPreviewContainer}.${CSS_CLASSES.topicPreviewLoading} .${CSS_CLASSES.topicPreviewPlaceholder}{ border: none; color: #c5c5c5; font-size: ${THUMBNAIL_SIZE_PX * 0.20}px; }
            .${CSS_CLASSES.topicPreviewContainer}[data-clickable="true"]:not(.${CSS_CLASSES.topicPreviewLoading}):hover .${CSS_CLASSES.topicPreviewPlaceholder} { color: #888; background-color: #f0f0f0; border-color: #bbb; }
            ${SELECTORS.topicCell} ${SELECTORS.topicTitleLink} { font-size: 1.05em; font-weight: 500; line-height: 1.4; text-align: center !important; display: block; max-width: 95%; margin: 0 auto 5px auto; order: 1; }
            ${SELECTORS.topicCell} ${SELECTORS.topicMetaData}, ${SELECTORS.topicCell} ${SELECTORS.topicTagsContainer} { text-align: center !important; display: block; width: 100%; margin-top: 5px; font-size: 0.9em; color: #666; order: 2; justify-content: center; }
            ${SELECTORS.topicCell} ${SELECTORS.topicTagsContainer} { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
            .${CSS_CLASSES.galleryOverlay} { position: fixed; inset: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.88); display: flex; align-items: center; justify-content: center; z-index: 9999; opacity: 0; transition: opacity 0.3s ease; pointer-events: none; flex-direction: column; padding: 15px; box-sizing: border-box; }
            .${CSS_CLASSES.galleryOverlay}.${CSS_CLASSES.galleryVisible} { opacity: 1; pointer-events: auto; }
            .${CSS_CLASSES.galleryImage} { max-width: calc(100% - ${galleryButtonSize * 2 + 40}px); max-height: calc(100% - ${galleryButtonSize + 40}px); display: block; object-fit: contain; margin: auto; opacity: 0; transition: opacity ${IMAGE_LOAD_TRANSITION_MS}ms linear; border-radius: 4px; box-shadow: 0 5px 15px rgba(0,0,0,0.4); background-color: rgba(30,30,30,0.5); }
            .${CSS_CLASSES.galleryStatus} { position: absolute; top: 20px; left: 50%; transform: translateX(-50%); color: #ccc; font-size: 0.9em; text-align: center; margin: 0; padding: 5px 12px; background: rgba(0, 0, 0, 0.6); border-radius: 12px; min-width: 80px; max-width: 80%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: opacity 0.2s ease; z-index: 10001; opacity: 1; }
            .${CSS_CLASSES.galleryStatus}:empty { opacity: 0; }
            .${CSS_CLASSES.galleryPrev}, .${CSS_CLASSES.galleryNext}, .${CSS_CLASSES.galleryClose}, .${CSS_CLASSES.galleryDownload} { position: absolute; background: rgba(40, 40, 40, 0.7); color: rgba(255, 255, 255, 0.9); border: none; cursor: pointer; border-radius: 50%; width: ${galleryButtonSize}px; height: ${galleryButtonSize}px; display: flex; align-items: center; justify-content: center; z-index: 10001; transition: background-color 0.2s ease, opacity 0.2s ease, transform 0.1s ease; opacity: 0.7; line-height: 1; user-select: none; }
            .${CSS_CLASSES.galleryPrev}:hover, .${CSS_CLASSES.galleryNext}:hover, .${CSS_CLASSES.galleryClose}:hover, .${CSS_CLASSES.galleryDownload}:hover { background: rgba(20, 20, 20, 0.9); opacity: 1; }
            .${CSS_CLASSES.galleryPrev}:active, .${CSS_CLASSES.galleryNext}:active, .${CSS_CLASSES.galleryClose}:active, .${CSS_CLASSES.galleryDownload}:active { transform: scale(0.92); transition-duration: 0.05s; }
            .${CSS_CLASSES.galleryPrev} { left: 20px; top: 50%; transform: translateY(-50%); font-size: ${galleryNavFontSize}px; padding-right: 3px; }
            .${CSS_CLASSES.galleryNext} { right: 20px; top: 50%; transform: translateY(-50%); font-size: ${galleryNavFontSize}px; padding-left: 3px; }
            .${CSS_CLASSES.galleryClose} { top: 15px; right: 15px; font-size: ${galleryActionFontSize}px; }
            .${CSS_CLASSES.galleryDownload} { top: 15px; right: ${galleryDownloadBtnRightPos}px; font-size: ${galleryActionFontSize - 2}px; font-weight: normal; }
            .${CSS_CLASSES.galleryOverlay}[data-single-image="true"] .${CSS_CLASSES.galleryPrev},
            .${CSS_CLASSES.galleryOverlay}[data-single-image="true"] .${CSS_CLASSES.galleryNext} { display: none; }
        `;
        try { const styleElement = document.createElement('style'); styleElement.id = styleId; styleElement.textContent = css; (document.head || document.documentElement).appendChild(styleElement); } catch (error) { logError('InjectStyles', 'Failed to inject CSS', error); }
    }

    function createGalleryDOM() {
        const overlayId = CSS_CLASSES.galleryOverlay;
        let needsListenerUpdate = false;
        galleryOverlay = document.getElementById(overlayId);
        if (galleryOverlay) {
            // logInfo('CreateGalleryDOM', 'Gallery overlay found. Updating references...');
            galleryStatus = galleryOverlay.querySelector(`.${CSS_CLASSES.galleryStatus}`);
            galleryPrevBtn = galleryOverlay.querySelector(`.${CSS_CLASSES.galleryPrev}`);
            galleryImage = galleryOverlay.querySelector(`.${CSS_CLASSES.galleryImage}`);
            galleryNextBtn = galleryOverlay.querySelector(`.${CSS_CLASSES.galleryNext}`);
            galleryCloseBtn = galleryOverlay.querySelector(`.${CSS_CLASSES.galleryClose}`);
            galleryDownloadBtn = galleryOverlay.querySelector(`.${CSS_CLASSES.galleryDownload}`);
            const coreElements = [galleryStatus, galleryPrevBtn, galleryImage, galleryNextBtn, galleryCloseBtn, galleryDownloadBtn];
            if (coreElements.some(el => !el)) {
                logWarn('CreateGalleryDOM', 'Gallery overlay exists but core components missing. Forcing re-creation.');
                if (galleryOverlay.parentNode) galleryOverlay.parentNode.removeChild(galleryOverlay);
                galleryOverlay = null; // Will trigger creation block below
            } else {
                const buttons = [galleryPrevBtn, galleryNextBtn, galleryCloseBtn, galleryDownloadBtn];
                if (buttons.some(btn => btn && !btn.getAttribute('data-listener-added'))) {
                    needsListenerUpdate = true;
                }
            }
        }
        if (!galleryOverlay) {
            // logInfo('CreateGalleryDOM', 'Gallery overlay not found. Creating elements...');
            try {
                galleryOverlay = document.createElement('div'); galleryOverlay.id = overlayId; galleryOverlay.className = CSS_CLASSES.galleryOverlay;
                galleryStatus = document.createElement('div'); galleryStatus.className = CSS_CLASSES.galleryStatus;
                galleryPrevBtn = document.createElement('button'); galleryPrevBtn.className = CSS_CLASSES.galleryPrev; galleryPrevBtn.innerHTML = UI_TEXTS.arrowPrev; galleryPrevBtn.setAttribute('aria-label', 'Previous Image');
                galleryImage = document.createElement('img'); galleryImage.className = CSS_CLASSES.galleryImage; galleryImage.alt = UI_TEXTS.galleryImageAlt;
                galleryNextBtn = document.createElement('button'); galleryNextBtn.className = CSS_CLASSES.galleryNext; galleryNextBtn.innerHTML = UI_TEXTS.arrowNext; galleryNextBtn.setAttribute('aria-label', 'Next Image');
                galleryCloseBtn = document.createElement('button'); galleryCloseBtn.className = CSS_CLASSES.galleryClose; galleryCloseBtn.innerHTML = UI_TEXTS.closeButton; galleryCloseBtn.setAttribute('aria-label', 'Close Gallery');
                galleryDownloadBtn = document.createElement('button'); galleryDownloadBtn.className = CSS_CLASSES.galleryDownload; galleryDownloadBtn.title = UI_TEXTS.galleryDownloadButtonTitle; galleryDownloadBtn.innerHTML = UI_TEXTS.downloadButton; galleryDownloadBtn.setAttribute('aria-label', 'Download Image (Shortcut: S)');
                galleryOverlay.append(galleryStatus, galleryPrevBtn, galleryImage, galleryNextBtn, galleryCloseBtn, galleryDownloadBtn);
                if (document.body) {
                    document.body.appendChild(galleryOverlay);
                    needsListenerUpdate = true;
                    logInfo('CreateGalleryDOM', 'Gallery created and appended to DOM.');
                } else {
                    logError('CreateGalleryDOM', 'document.body not found for gallery append.');
                    galleryOverlay = galleryImage = galleryStatus = galleryPrevBtn = galleryNextBtn = galleryCloseBtn = galleryDownloadBtn = null;
                }
            } catch (error) {
                logError('CreateGalleryDOM', 'Error during gallery element creation:', error);
                galleryOverlay = galleryImage = galleryStatus = galleryPrevBtn = galleryNextBtn = galleryCloseBtn = galleryDownloadBtn = null;
            }
        }
        if (needsListenerUpdate && galleryOverlay) { addGalleryEventListeners(); }
        else if (!galleryOverlay) { logWarn('CreateGalleryDOM', 'Cannot add listeners: galleryOverlay is null.'); }
    }

    function addGalleryEventListeners() {
        // logInfo('AddListeners', 'Attempting to add/update gallery event listeners.');
        const addListener = (element, event, handler, name) => {
            if (element) {
                element.removeEventListener(event, handler); // Prevent duplicates if somehow data-attribute is lost
                element.addEventListener(event, handler);
                element.setAttribute('data-listener-added', 'true');
            } else {
                logWarn('AddListeners', `${name} button not found. Cannot add listener.`);
            }
        };
        addListener(galleryCloseBtn, 'click', hideGallery, 'Close');
        addListener(galleryPrevBtn, 'click', showPrevImage, 'Prev');
        addListener(galleryNextBtn, 'click', showNextImage, 'Next');
        addListener(galleryDownloadBtn, 'click', downloadCurrentImage, 'Download');
    }

    async function getStoredThumbnail(topicIdKey) { if (typeof browser === "undefined" || !browser.storage?.local) return null; try { const d = await browser.storage.local.get(PERSISTENT_THUMB_CACHE_KEY), c = d?.[PERSISTENT_THUMB_CACHE_KEY] || {}, e = c[topicIdKey]; if (e?.url && (Date.now() - e.timestamp) < CACHE_DURATION_MS) return e.url; if (e) { delete c[topicIdKey]; browser.storage.local.set({ [PERSISTENT_THUMB_CACHE_KEY]: c }).catch(err => logError('Cache Cleanup', err)); } } catch (err) { logError('Cache Read', topicIdKey, err); } return null; }
    async function setStoredThumbnail(topicIdKey, imageUrl) { if (!topicIdKey || !imageUrl || typeof browser === "undefined" || !browser.storage?.local) return; try { const d = await browser.storage.local.get(PERSISTENT_THUMB_CACHE_KEY), c = d?.[PERSISTENT_THUMB_CACHE_KEY] || {}; c[topicIdKey] = { url: imageUrl, timestamp: Date.now() }; await browser.storage.local.set({ [PERSISTENT_THUMB_CACHE_KEY]: c }); } catch (err) { logError('Cache Write', topicIdKey, err); } }

    function showGallery() {
        createGalleryDOM();
        if (!galleryOverlay) { logError('ShowGallery', 'Critical fail: galleryOverlay not available.'); alert('Error: Could not initialize image gallery.'); return; }
        galleryOverlay.classList.add(CSS_CLASSES.galleryVisible);
        document.removeEventListener('keydown', handleKeyDown);
        document.addEventListener('keydown', handleKeyDown);
    }

    function hideGallery() {
        if (galleryOverlay) {
            galleryOverlay.classList.remove(CSS_CLASSES.galleryVisible);
            if (galleryImage) { galleryImage.src = ''; galleryImage.style.opacity = '0'; }
            if (galleryStatus) { galleryStatus.textContent = ''; }
        }
        activeGallery = { topicId: null, images: [], currentIndex: -1, topicTitle: null, opUsername: null };
        document.removeEventListener('keydown', handleKeyDown);
    }

    function updateGalleryImage() {
        if (!galleryOverlay || !galleryImage || !galleryStatus) { logError('UpdateGalleryImage', 'Aborting: Essential gallery elements not found.'); hideGallery(); return; }
        const { images, currentIndex } = activeGallery, totalImages = images.length;
        if (totalImages === 0 || currentIndex < 0) { galleryImage.src = ''; galleryImage.style.opacity = '0'; galleryStatus.textContent = UI_TEXTS.galleryNoImages; galleryOverlay.dataset.singleImage = 'true'; if (galleryPrevBtn) galleryPrevBtn.style.display = 'none'; if (galleryNextBtn) galleryNextBtn.style.display = 'none'; return; }
        const imageUrl = images[currentIndex]; galleryImage.style.opacity = '0'; galleryImage.src = '';
        setTimeout(() => {
            if (!galleryOverlay || !galleryImage || !galleryStatus) { logWarn('UpdateGalleryImage Timeout', 'Gallery elements disappeared.'); return; }
            let loaded = false;
            const onImgLoad = () => { if(loaded) return; loaded = true; galleryImage.style.opacity = '1'; galleryImage.onerror = null; preloadAdjacentImages();};
            const onImgError = () => { if(loaded) return; loaded = true; logWarn('Gallery Img Load Error',imageUrl); galleryStatus.textContent = `Error ${currentIndex+1}/${totalImages}`; galleryImage.style.opacity='1'; galleryImage.onload = null;};
            galleryImage.onload = onImgLoad; galleryImage.onerror = onImgError;
            galleryImage.src = imageUrl; galleryStatus.textContent = `${currentIndex + 1} / ${totalImages}`;
            const isSingle = totalImages <= 1; galleryOverlay.dataset.singleImage = String(isSingle);
            if(galleryPrevBtn) galleryPrevBtn.style.display = isSingle ? 'none' : 'flex'; if(galleryNextBtn) galleryNextBtn.style.display = isSingle ? 'none' : 'flex';
            if (galleryImage.complete && !loaded) { if (!galleryImage.naturalWidth) onImgError(); else onImgLoad(); }
            if(loaded) { galleryImage.onload = null; galleryImage.onerror = null; }
        }, IMAGE_LOAD_TRANSITION_MS / 3);
    }

    function preloadAdjacentImages() { if (activeGallery.images.length <= 1) return; const N = activeGallery.images.length, ci = activeGallery.currentIndex, nextI = (ci + 1) % N, prevI = (ci - 1 + N) % N; const p = (u) => { if (!u || typeof u !== 'string' || u.length === 0) return; try { const i = new Image(); i.src = u; } catch (e) { logWarn('Preload Fail', u, e); }}; if (nextI !== ci) p(activeGallery.images[nextI]); if (prevI !== ci && prevI !== nextI) p(activeGallery.images[prevI]); }
    function showNextImage() { if (activeGallery.images.length === 0) return; activeGallery.currentIndex = (activeGallery.currentIndex + 1) % activeGallery.images.length; updateGalleryImage(); }
    function showPrevImage() { if (activeGallery.images.length === 0) return; activeGallery.currentIndex = (activeGallery.currentIndex - 1 + activeGallery.images.length) % activeGallery.images.length; updateGalleryImage(); }

    function handleKeyDown(event) {
        if (galleryOverlay && !document.body.contains(galleryOverlay)) { logWarn('handleKeyDown', 'Gallery overlay no longer in DOM. Removing keydown listener.'); document.removeEventListener('keydown', handleKeyDown); activeGallery = { topicId: null, images: [], currentIndex: -1, topicTitle: null, opUsername: null }; return; }
        if (!galleryOverlay?.classList.contains(CSS_CLASSES.galleryVisible)) return;
        const targetTagName = event.target?.tagName?.toLowerCase(); if (targetTagName === 'input' || targetTagName === 'textarea' || targetTagName === 'select' || event.target?.isContentEditable) return;
        let handled = false;
        switch (event.key) {
            case 'ArrowRight': case ' ': showNextImage(); handled = true; break;
            case 'ArrowLeft': showPrevImage(); handled = true; break;
            case 'Escape': hideGallery(); handled = true; break;
            case 's': case 'S': if (galleryDownloadBtn) downloadCurrentImage(event); else logWarn('Shortcut', 'Download btn missing.'); handled = true; break;
        }
        if (handled) { event.preventDefault(); event.stopPropagation(); }
    }

    function getOriginalImageUrl(url) { if (!url || typeof url !== 'string') return url; try { let oUrl = url.replace(/_(\d+|[a-z])(?:_(\d+)x(\d+))?\.(jpe?g|png|gif|webp|bmp)$/i, '.$4'); if (oUrl.includes('/optimized/')) oUrl = oUrl.replace('/optimized/', '/original/'); if (oUrl.includes('/thumbnail/')) oUrl = oUrl.replace('/thumbnail/', '/original/'); if (oUrl.includes('?')) { const bUrl = oUrl.split('?')[0]; if (bUrl !== oUrl && /\.(jpe?g|png|gif|webp|bmp)$/i.test(bUrl)) oUrl = bUrl; } return oUrl; } catch (e) { logError('getOriginalImageUrl',url,e); return url;}}

    function downloadCurrentImage(event) {
        if (event) event.stopPropagation();
        if (!galleryImage || !galleryStatus || !galleryOverlay) { logError('Download', 'Gallery elements missing.'); return; }
        const imgUrl = galleryImage.src; if (!imgUrl || imgUrl.startsWith('data:') || imgUrl.startsWith('blob:')) { logWarn('Download', 'Invalid URL:', imgUrl); const oS = galleryStatus.textContent; galleryStatus.textContent = UI_TEXTS.galleryDownloadWarn; setTimeout(() => { if (galleryStatus?.textContent === UI_TEXTS.galleryDownloadWarn) galleryStatus.textContent = oS; }, 2000); return; }
        const tT = activeGallery.topicTitle||'T', opU = activeGallery.opUsername||'U', idx = activeGallery.currentIndex, iN = (idx >= 0 ? idx + 1:1).toString().padStart(2,'0');
        try {
            let bFn = `${opU} - ${tT}-Img_${iN}`.replace(/[\\/:*?"<>|]/g,'_').replace(/\s+/g,' ').trim().substring(0,150).replace(/\.+$/,'').replace(/\.{2,}/g,'.'); let ext = '.jpg';
            try { const pN = new URL(imgUrl).pathname; const m = pN.match(/\.(jpe?g|png|gif|webp|bmp)$/i); if (m?.[1]) ext = '.' + m[1].toLowerCase(); } catch(e) {/*ignore*/}
            let fFn = (bFn||`Image_${iN}`) + ext; const oS = galleryStatus.textContent; galleryStatus.textContent = UI_TEXTS.galleryDownloadOk;
            fetch(imgUrl).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); }).then(b => { const bU = window.URL.createObjectURL(b); const l = document.createElement('a'); l.href = bU; l.download = fFn; document.body.appendChild(l); l.click(); document.body.removeChild(l); window.URL.revokeObjectURL(bU); setTimeout(() => { if (galleryStatus?.textContent === UI_TEXTS.galleryDownloadOk) galleryStatus.textContent = oS;}, 1500); }).catch(err => { logError('Download Fetch/Blob', imgUrl, err); if(galleryStatus) galleryStatus.textContent = UI_TEXTS.galleryDownloadErr; setTimeout(() => { if (galleryStatus?.textContent === UI_TEXTS.galleryDownloadErr) galleryStatus.textContent = (activeGallery.images.length>0 && activeGallery.currentIndex>=0) ? `${activeGallery.currentIndex+1}/${activeGallery.images.length}` : oS; }, 3000);});
        } catch (err) { logError('Download Prep',err); if(galleryStatus) galleryStatus.textContent = 'Prep Error!'; setTimeout(() => { if (galleryStatus?.textContent === 'Prep Error!') galleryStatus.textContent = (activeGallery.images.length>0&&activeGallery.currentIndex>=0)?`${activeGallery.currentIndex+1}/${activeGallery.images.length}`:'';}, 2000);}
    }

    async function fetchTopicImagesForPreview(topicIdKey, topicUrl) {
        if (topicImageCache[topicIdKey] !== undefined) return topicImageCache[topicIdKey]?.[0] || null;
        try { const response = await fetch(topicUrl); if (!response.ok) throw new Error(`HTTP ${response.status}`); const html = await response.text(); let imgs = null;
            try { const p = new DOMParser(), d = p.parseFromString(html,'text/html'), pre = d.querySelector(SELECTORS.preloadedData); if (pre?.dataset?.preloaded) { const data = JSON.parse(pre.dataset.preloaded), tk = Object.keys(data).find(k=>k.startsWith('topic_')); let posts; if (tk && typeof data[tk]==='string') posts=JSON.parse(data[tk])?.post_stream?.posts; else if(data?.post_stream?.posts) posts=data.post_stream.posts; if(posts?.[0]?.cooked) imgs = extractImagesFromCookedHtml(posts[0].cooked);}} catch (e) { logWarn('Fetch Preloaded Parse',topicIdKey,e); }
            if (!imgs) { const p = new DOMParser(), d = p.parseFromString(html,'text/html'), fpc = d.querySelector(SELECTORS.firstPostCookedContent); if (fpc) imgs = extractImagesFromCookedHtml(fpc.innerHTML); }
            topicImageCache[topicIdKey] = imgs || []; const firstImg = imgs?.[0] || null; if (firstImg) await setStoredThumbnail(topicIdKey, firstImg); return firstImg;
        } catch (err) { logError('Fetch Topic Data',topicUrl,err); topicImageCache[topicIdKey] = []; return null; }
    }

    function extractImagesFromCookedHtml(htmlContent) { if (!htmlContent || typeof htmlContent !== 'string') return []; try { const p = new DOMParser(), d = p.parseFromString(htmlContent,'text/html'); let iEls = Array.from(d.querySelectorAll(SELECTORS.galleryImageLink)); if (iEls.length === 0) iEls = Array.from(d.querySelectorAll(SELECTORS.galleryImageFallback)); return iEls.map(img => img?.src).filter(s => s && !s.includes('/emoji/') && !s.includes('/images/transparent.png') && !/\/user_avatar\//.test(s) && !/\/avatar\//.test(s) && !s.startsWith('data:') && !s.startsWith('blob:'));} catch(e){ logError('Parse Cooked HTML',e); return [];}}

    async function openGalleryForTopic(event, topicIdKey, topicUrl, topicTitle='Topic', opUsername='User') {
        if (event) { event.preventDefault(); event.stopPropagation(); } if (!topicIdKey || !topicUrl) { logWarn('OpenGallery', 'Missing ID/URL.'); return; }
        if (activeGallery.topicId === topicIdKey && galleryOverlay?.classList.contains(CSS_CLASSES.galleryVisible)) { showGallery(); return; }
        logInfo('OpenGallery', `Opening for ${topicIdKey}`);
        activeGallery = { topicId: topicIdKey, images: [], currentIndex: -1, topicTitle: topicTitle||'Topic', opUsername: opUsername||'User' };
        showGallery();
        if (!galleryOverlay || !galleryImage || !galleryStatus) { logError('OpenGallery', 'Elements unavailable post showGallery().'); hideGallery(); return; }
        galleryImage.src = ''; galleryImage.style.opacity = '0'; galleryStatus.textContent = UI_TEXTS.galleryLoading; galleryOverlay.dataset.singleImage = 'true';
        let imgUrls = topicImageCache[topicIdKey];
        if (imgUrls === undefined) { galleryStatus.textContent = UI_TEXTS.galleryLoadingFetch; await fetchTopicImagesForPreview(topicIdKey, topicUrl); imgUrls = topicImageCache[topicIdKey]; }
        if (!galleryOverlay || !galleryStatus) { logError('OpenGallery [State Check]', 'Gallery status element gone before image processing.'); hideGallery(); return; } // Re-check after await
        if (imgUrls?.length > 0) { galleryStatus.textContent = UI_TEXTS.galleryLoadingHQ; activeGallery.images = imgUrls.map(url => getOriginalImageUrl(url)); activeGallery.currentIndex = 0; updateGalleryImage(); }
        else { galleryStatus.textContent = UI_TEXTS.galleryNoImages; galleryOverlay.dataset.singleImage = 'true'; if(galleryPrevBtn) galleryPrevBtn.style.display = 'none'; if(galleryNextBtn) galleryNextBtn.style.display = 'none'; }
    }

    function getTopicDetailsFromRow(rowEl) { const l = rowEl?.querySelector(SELECTORS.topicLink), av = rowEl?.querySelector(SELECTORS.avatarImage); let uN = 'User'; if (av?.title) { const p = av.title.split(' - '); if (p.length>0 && p[0].trim()) uN = p[0].trim();} const t = l ? l.textContent.trim() : 'Unknown Topic'; return { title: t, username: uN, linkElement: l }; }

    function createThumbnailContainer(topicIdKey, topicUrl, imageUrl) {
        const c = document.createElement('div'); c.className = CSS_CLASSES.topicPreviewContainer; c.title = UI_TEXTS.galleryTitle; c.dataset.topicIdKey = topicIdKey; c.dataset.clickable = 'true';
        const th = document.createElement('img'); th.src = imageUrl; th.loading = 'lazy'; th.alt = UI_TEXTS.thumbnailAlt; th.className = CSS_CLASSES.topicPreviewThumbnail;
        th.onerror = function() { logWarn('Thumbnail Load Err',`${this.src} for ${topicIdKey}`); if(c.parentNode?.contains(c)){const r=c.closest(SELECTORS.topicRow); c.parentNode.removeChild(c); if(r){const{linkElement:l}=getTopicDetailsFromRow(r); if(l&&!r.querySelector(`.${CSS_CLASSES.topicPreviewContainer}`)){addPlaceholder(r,l,UI_TEXTS.placeholderSymbolError,UI_TEXTS.placeholderError,topicIdKey,topicUrl);}}}};
        c.appendChild(th);
        c.addEventListener('click', (e) => { const r = c.closest(SELECTORS.topicRow); if (!r) { openGalleryForTopic(e, topicIdKey, topicUrl); return; } const {title,username}=getTopicDetailsFromRow(r); openGalleryForTopic(e, topicIdKey, topicUrl, title, username); });
        return c;
    }

    function addPlaceholder(rowEl, linkEl, symbol, titleTxt, topicIdKey=null, topicUrl=null, isLoading=false) {
        const tc = linkEl?.closest(SELECTORS.topicCell); if (!tc) return;
        if (rowEl.querySelector(`.${CSS_CLASSES.topicPreviewContainer}:not(.${CSS_CLASSES.topicPreviewLoading})`)) { if (linkEl && !linkEl.dataset.previewProcessed) linkEl.dataset.previewProcessed = 'true'; return; }
        const exLoadPh = topicIdKey ? rowEl.querySelector(`.${CSS_CLASSES.topicPreviewContainer}.${CSS_CLASSES.topicPreviewLoading}[data-topic-id-key="${topicIdKey}"]`) : null; if (exLoadPh) exLoadPh.remove();
        if (linkEl) linkEl.dataset.previewProcessed = 'true';
        const c = document.createElement('div'); c.className = CSS_CLASSES.topicPreviewContainer; c.title = titleTxt; if (isLoading) c.classList.add(CSS_CLASSES.topicPreviewLoading); c.dataset.topicIdKey = topicIdKey || 'no-id';
        const phS = document.createElement('span'); phS.textContent = isLoading ? UI_TEXTS.placeholderSymbolLoading : symbol; phS.className = CSS_CLASSES.topicPreviewPlaceholder; c.appendChild(phS);
        if (topicIdKey && topicUrl && !isLoading && symbol !== UI_TEXTS.placeholderSymbolNoId) { c.dataset.clickable = 'true'; c.addEventListener('click', (e) => { const r = c.closest(SELECTORS.topicRow); if (!r) { openGalleryForTopic(e,topicIdKey,topicUrl); return; } const {title,username}=getTopicDetailsFromRow(r); openGalleryForTopic(e,topicIdKey,topicUrl,title,username);});} else { c.style.cursor = 'default';}
        if (!rowEl.querySelector(`.${CSS_CLASSES.topicPreviewContainer}`)) tc.insertBefore(c, tc.firstChild);
    }

    function scheduleProcessPreviewQueue() { clearTimeout(processQueueTimeoutId); processQueueTimeoutId = setTimeout(async () => { if (isPreviewQueueProcessing || fetchPreviewQueue.length === 0) return; isPreviewQueueProcessing = true; while (fetchPreviewQueue.length > 0) { const i = fetchPreviewQueue.shift(); if (!i || !i.rowElement?.isConnected) continue; const {topicIdKey, topicUrl, rowElement, linkElement} = i; const lp = rowElement.querySelector(`.${CSS_CLASSES.topicPreviewContainer}.${CSS_CLASSES.topicPreviewLoading}[data-topic-id-key="${topicIdKey}"]`); if (lp) { const imgUrl = await fetchTopicImagesForPreview(topicIdKey, topicUrl); const curC = rowElement.querySelector(`.${CSS_CLASSES.topicPreviewContainer}[data-topic-id-key="${topicIdKey}"]`); if (curC?.parentNode) { if (imgUrl) { const tC = createThumbnailContainer(topicIdKey, topicUrl, imgUrl); curC.parentNode.replaceChild(tC, curC); } else { curC.remove(); addPlaceholder(rowElement,linkElement,UI_TEXTS.placeholderSymbolView,UI_TEXTS.placeholderNoImages,topicIdKey,topicUrl);}}} if (fetchPreviewQueue.length > 0) await delay(FETCH_DELAY_MS); } isPreviewQueueProcessing = false; }, DEBOUNCE_PROCESS_QUEUE_MS); }

    async function addInitialPreview(linkEl, imgMapRef) {
         if (!linkEl?.href || linkEl.dataset.previewProcessed === 'true') return;
         const rowEl = linkEl.closest(SELECTORS.topicRow), tc = linkEl.closest(SELECTORS.topicCell); if (!rowEl || !tc) { linkEl.dataset.previewProcessed = 'true'; return; }
         if (rowEl.querySelector(`.${CSS_CLASSES.topicPreviewContainer}:not(.${CSS_CLASSES.topicPreviewLoading})`)) { linkEl.dataset.previewProcessed = 'true'; return; }
         const topicUrl = linkEl.href, topicIdKey = getTopicIdFromUrl(topicUrl); linkEl.dataset.previewProcessed = 'true';
         const initUrl = (topicIdKey && imgMapRef?.[topicIdKey]) ? imgMapRef[topicIdKey] : null;
         if (initUrl) { const cont = createThumbnailContainer(topicIdKey,topicUrl,initUrl); if (!rowEl.querySelector(`.${CSS_CLASSES.topicPreviewContainer}`)) tc.insertBefore(cont, tc.firstChild); setStoredThumbnail(topicIdKey, initUrl).catch(e=>logWarn('AddPreview Cache Fail',e)); return; }
         if (topicIdKey) { const cachUrl = await getStoredThumbnail(topicIdKey); if (cachUrl) { const cont = createThumbnailContainer(topicIdKey,topicUrl,cachUrl); if (!rowEl.querySelector(`.${CSS_CLASSES.topicPreviewContainer}`)) tc.insertBefore(cont,tc.firstChild); return; } addPlaceholder(rowEl,linkEl,UI_TEXTS.placeholderSymbolLoading,UI_TEXTS.placeholderLoading,topicIdKey,topicUrl,true); if (!fetchPreviewQueue.some(it=>it.topicIdKey === topicIdKey)) { fetchPreviewQueue.push({ topicIdKey, topicUrl, rowElement:rowEl, linkElement:linkEl }); scheduleProcessPreviewQueue();}} else { logWarn('AddPreview No ID', topicUrl); addPlaceholder(rowEl,linkEl,UI_TEXTS.placeholderSymbolNoId,UI_TEXTS.placeholderNoId); }
    }

    async function processCurrentDOM(imageMapToUse) {
        const links = document.querySelectorAll(`${SELECTORS.topicCell} ${SELECTORS.topicLink}:not([data-preview-processed="true"])`);
        // Use a for...of loop for sequential async operations if needed, or Promise.allSettled for parallel
        for (const link of links) {
            const row = link.closest(SELECTORS.topicRow);
            if (row && link.href?.includes('/t/')) {
                // Await each addInitialPreview to process sequentially, reducing load bursts
                // Or collect promises and use Promise.allSettled(promises) for parallel processing.
                // Given fetch queue exists, direct await might be too slow here. Stick to original async non-blocking pattern.
                addInitialPreview(link, imageMapToUse).catch(e => logError('ProcessDOM AddPreview', e));
            } else if (!link.dataset.previewProcessed) {
                link.dataset.previewProcessed = 'true'; // Mark non-topic links as processed too
            }
        }
        // await Promise.allSettled(promises); // If using promises array
        if (fetchPreviewQueue.length > 0) scheduleProcessPreviewQueue();
    }

    function getInitialData() {
        const preDiv = document.querySelector(SELECTORS.preloadedData); if (!preDiv?.dataset?.preloaded) return null;
        try { const d = JSON.parse(preDiv.dataset.preloaded); let lSrc; if (typeof d.topic_list==='string')lSrc=JSON.parse(d.topic_list);else if(d?.topic_list?.topic_list)lSrc=d.topic_list;else if(d?.topic_list)lSrc=d;else if(d?.topics)lSrc={topic_list:d};else return null; const ts=lSrc?.topic_list?.topics; if(ts&&Array.isArray(ts)){const m={};ts.forEach(t=>{if(t?.id&&t.image_url)m[`t${t.id}`]=t.image_url;}); return Object.keys(m).length>0?m:null;}else{logWarn('InitialData','Topics array not found.',lSrc);return null;}}catch(e){logError('InitialData Parse',e);return null;}
    }

    async function run() {
        logInfo('Init', `Starting v${SCRIPT_VERSION}...`);
        injectStyles();
        createGalleryDOM();
        initialImageMap = getInitialData() || {};
        if (document.readyState === 'loading') await new Promise(r => document.addEventListener('DOMContentLoaded', r));
        if (!document.body) { logWarn('Init', 'document.body not found. Waiting...'); await new Promise(r => { const o=new MutationObserver(()=>{if(document.body){o.disconnect();r();}});o.observe(document.documentElement,{childList:true});}); logInfo('Init','document.body available.'); if (!galleryOverlay) createGalleryDOM(); }
        
        await processCurrentDOM(initialImageMap);

        const getTargetNode = () => document.querySelector(SELECTORS.mainOutlet) || document.body;
        let observedNodeReference = getTargetNode(); // Store a reference to the node we are observing

        const startObserver = (nodeToObserve) => {
            if (mutationObserver) mutationObserver.disconnect();
            try {
                mutationObserver = new MutationObserver(enhancedObserverCallback);
                mutationObserver.observe(nodeToObserve, { childList: true, subtree: true });
                observedNodeReference = nodeToObserve; // Update reference
                logInfo('Init', `MutationObserver started on: ${nodeToObserve.id || nodeToObserve.tagName}.`);
            } catch (observerError) { logError('Init Observer', observerError); mutationObserver = null; }
        };
        
        const enhancedObserverCallback = (mutationsList) => {
            let currentTargetNode = getTargetNode();
            // If the initially observed node is no longer in the DOM or #main-outlet has appeared and we were on body
            if (!document.body.contains(observedNodeReference) || (observedNodeReference === document.body && currentTargetNode !== document.body)) {
                 logWarn('Observer', 'Observed node changed or detached. Re-evaluating observer target.');
                 currentTargetNode = getTargetNode(); // Re-fetch the best target
                 if (currentTargetNode) {
                     startObserver(currentTargetNode); // Re-start observer on new/correct target
                 } else {
                     logError('Observer', 'Could not find a valid node to observe after target detachment.');
                     return; // Cannot proceed
                 }
            }

            let significantChange = false;
            for (const mutation of mutationsList) {
                if (mutation.type === 'childList') {
                    if (SELECTORS.mainOutlet.startsWith('#') && (Array.from(mutation.removedNodes).some(n => n.id === SELECTORS.mainOutlet.substring(1)) ||
                        Array.from(mutation.addedNodes).some(n => n.id === SELECTORS.mainOutlet.substring(1)))
                       ) {
                        significantChange = true; // #main-outlet itself was added/removed
                        break;
                    }
                    if (mutation.target === currentTargetNode && (mutation.addedNodes.length > 20 || mutation.removedNodes.length > 20)) {
                         significantChange = true; // Large number of direct children changed in main target
                         break;
                    }
                }
            }

            if (significantChange) {
                logInfo('Observer', 'Significant DOM change. Re-processing DOM, ensuring gallery.');
                const newData = getInitialData(); // Check if new preloaded data exists
                if (newData) initialImageMap = newData;

                createGalleryDOM(); // Ensure gallery DOM is intact or recreated
                document.querySelectorAll(`${SELECTORS.topicLink}[data-preview-processed="true"]`).forEach(link => link.removeAttribute('data-preview-processed'));
                processCurrentDOM(initialImageMap).catch(e => logError('Observer', 'Error re-processing DOM', e));
            }

            let linksToAdd = new Set();
            for (const mutation of mutationsList) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const check = (l) => { if (l && !l.dataset.previewProcessed && l.matches(SELECTORS.topicLink) && l.href?.includes('/t/') && l.closest(SELECTORS.topicRow)) linksToAdd.add(l);};
                            if (node.matches(SELECTORS.topicLink)) check(node);
                            else node.querySelectorAll(`${SELECTORS.topicLink}:not([data-preview-processed="true"])`).forEach(check);
                        }
                    });
                }
            }
            if (linksToAdd.size > 0) {
                linksToAdd.forEach(link => { addInitialPreview(link, initialImageMap).catch(e => logError('Observer AddInitialPreview', e)); });
                if (fetchPreviewQueue.length > 0) scheduleProcessPreviewQueue();
            }
        };

        if (observedNodeReference) {
            startObserver(observedNodeReference);
        } else {
            logWarn('Init', 'Observer target node not found initially. Retrying after short delay.');
            // Fallback if target node isn't immediately available
            setTimeout(() => {
                const node = getTargetNode();
                if (node) startObserver(node);
                else logError('Init', 'Failed to find observer target node even after delay.');
            }, 1000);
        }
        logInfo('Init', `Extension v${SCRIPT_VERSION} init complete.`);
    }

    try { run().catch(err => logError('Run Execution', 'Unhandled promise rejection in run():', err)); }
    catch (error) { logError('Run Execution', 'Unexpected error during script initialization:', error); }

})();
