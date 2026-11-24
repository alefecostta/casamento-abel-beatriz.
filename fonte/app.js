// Cópia do HTML original, usada para exportar a versão de arquivo único com as edições
const ORIGINAL_PAGE_HTML = document.getElementById('site-data')
  ? '<!DOCTYPE html>\n' + document.documentElement.outerHTML
  : null;

// Estado principal do site e carrinho
let siteData = JSON.parse(JSON.stringify(window.DEFAULT_SITE_DATA));
let isEditMode = false;
let showAllGifts = true; // Mostra todos os 50 presentes da lista
let cart = [];
let leafletMap = null;
let leafletMarker = null;
let replacePhotoTargetIndex = null;

const STORAGE_KEY = 'casamento_abel_beatriz_site_data_v4';
const CART_STORAGE_KEY = 'casamento_abel_beatriz_cart_v1';
const IDB_NAME = 'CasamentoAbelBeatrizDB';
const IDB_STORE = 'siteState';

// Persistência robusta em IndexedDB (suporta dezenas de fotos em alta resolução)
function openSiteDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('IndexedDB indisponível'));
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

async function loadFromIndexedDB() {
  try {
    const db = await openSiteDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const getReq = store.get(STORAGE_KEY);
      getReq.onsuccess = () => resolve(getReq.result || null);
      getReq.onerror = () => reject(getReq.error);
    });
  } catch (e) {
    return null;
  }
}

async function saveToIndexedDB(data) {
  try {
    const db = await openSiteDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put(data, STORAGE_KEY);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('IndexedDB fallback:', e);
  }
}

async function clearIndexedDB() {
  try {
    const db = await openSiteDB();
    await new Promise(resolve => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(STORAGE_KEY);
      tx.oncomplete = () => resolve(true);
    });
  } catch (e) {}
}

// Utilitário para acessar/definir propriedades aninhadas (ex: "hero.title")
function getNestedValue(obj, path) {
  return path.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : ''), obj);
}

function setNestedValue(obj, path, value) {
  const parts = path.split('.');
  const last = parts.pop();
  const target = parts.reduce((acc, part) => {
    if (!acc[part]) acc[part] = {};
    return acc[part];
  }, obj);
  target[last] = value;
}

function formatBRL(value) {
  const num = Number(value) || 0;
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Carregamento inicial (prioriza IndexedDB -> servidor local -> localStorage -> padrão)
function setupAdminAccess() {
  const ADMIN_FLAG = 'casamento_abel_beatriz_admin';
  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash.toLowerCase();
  try {
    if (params.has('sair')) localStorage.removeItem(ADMIN_FLAG);
    else if (params.has('admin') || hash === '#admin') localStorage.setItem(ADMIN_FLAG, '1');
  } catch (e) {}
  let isAdmin = params.has('admin') || hash === '#admin';
  try {
    isAdmin = isAdmin || (!params.has('sair') && localStorage.getItem(ADMIN_FLAG) === '1');
  } catch (e) {}
  const floating = document.getElementById('admin-floating');
  if (floating) floating.style.display = isAdmin ? 'flex' : 'none';
}

async function initSite() {
  setupAdminAccess();
  try {
    const savedCart = localStorage.getItem(CART_STORAGE_KEY);
    if (savedCart) cart = JSON.parse(savedCart);
  } catch (e) {
    cart = [];
  }

  let loaded = false;

  // 1. Tenta carregar do IndexedDB (suporta muitas fotos de alta qualidade)
  const idbData = await loadFromIndexedDB();
  if (idbData && idbData.hero) {
    siteData = deepMerge(JSON.parse(JSON.stringify(window.DEFAULT_SITE_DATA)), idbData);
    loaded = true;
  }

  // 2. Se estiver em servidor HTTP, tenta /api/data
  if (!loaded && window.location.protocol.startsWith('http')) {
    try {
      const resp = await fetch('/api/data', { cache: 'no-store' });
      if (resp.ok) {
        const serverJson = await resp.json();
        if (serverJson && !serverJson.empty && serverJson.hero) {
          siteData = deepMerge(JSON.parse(JSON.stringify(window.DEFAULT_SITE_DATA)), serverJson);
          loaded = true;
        }
      }
    } catch (e) {}
  }

  // 3. Fallback para localStorage
  if (!loaded) {
    try {
      const localRaw = localStorage.getItem(STORAGE_KEY);
      if (localRaw) {
        const parsed = JSON.parse(localRaw);
        if (parsed && parsed.hero) {
          siteData = deepMerge(JSON.parse(JSON.stringify(window.DEFAULT_SITE_DATA)), parsed);
        }
      }
    } catch (e) {
      console.warn('Usando dados padrão:', e);
    }
  }

  applyTheme();
  renderAll();
  initMap();
  setupEditableListeners();
  loadRemoteContent();
}

// Presentes e dados de pagamento cadastrados no painel /admin (Google Planilhas).
// Se a planilha não responder, o site continua com a lista embutida.
const GIFT_PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><rect width="160" height="160" fill="#faf5ef"/><text x="80" y="98" font-size="56" text-anchor="middle">🎁</text></svg>'
  );

async function loadRemoteContent() {
  const endpoint = getRsvpEndpoint();
  if (!endpoint) return;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const resp = await fetch(`${endpoint}?action=public`, { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(timer);
    const data = await resp.json();
    if (!data || !data.ok) return;

    if (Array.isArray(data.gifts) && data.gifts.length) {
      const safeImg = v =>
        /^(data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+|https:\/\/[^"'<>\s]+)$/.test(v || '') ? v : '';
      siteData.giftsSection.items = data.gifts
        .filter(g => g && g.title)
        .map(g => ({
          id: Number(g.id),
          title: escapeHtml(g.title),
          price: Math.max(0, Number(g.price) || 0),
          category: escapeHtml(g.category || 'Outros'),
          img: safeImg(g.img)
        }));
      // Mantém o carrinho do convidado coerente com a lista atual
      cart = cart
        .map(c => {
          const g = siteData.giftsSection.items.find(i => i.id === c.id);
          return g ? { ...c, title: g.title, price: g.price, img: g.img } : null;
        })
        .filter(Boolean);
      try {
        localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
      } catch (e) {}
      updateCartBadges();
      populateGiftCategories();
      renderGiftsList();
    }

    const cfg = data.config || {};
    if (cfg.pixKey) siteData.giftsSection.pixKey = cfg.pixKey;
    if (cfg.pixHolder) siteData.giftsSection.pixHolder = cfg.pixHolder;
    if (/^https:\/\//.test(cfg.casarUrl || '')) siteData.giftsSection.casarUrl = cfg.casarUrl;
  } catch (err) {
    console.warn('Painel indisponível, usando a lista embutida:', err);
  }
}

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      deepMerge(target[key], source[key]);
    } else if (source[key] !== undefined) {
      target[key] = source[key];
    }
  }
  return target;
}

// Aplica as cores Rosa Canela no CSS
function applyTheme() {
  const t = siteData.theme || window.DEFAULT_SITE_DATA.theme;
  const root = document.documentElement;
  root.style.setProperty('--rose', t.rose || '#ad6f72');
  root.style.setProperty('--rose-dark', t.roseDark || '#78494e');
  root.style.setProperty('--rose-soft', t.roseSoft || '#e9d4cf');
  root.style.setProperty('--cream', t.cream || '#faf5ef');
  root.style.setProperty('--ink', t.ink || '#453334');

  const cRose = document.getElementById('color-rose');
  const cRoseTxt = document.getElementById('color-rose-text');
  if (cRose && cRoseTxt) {
    cRose.value = t.rose || '#ad6f72';
    cRoseTxt.value = t.rose || '#ad6f72';
  }
  const cDark = document.getElementById('color-roseDark');
  const cDarkTxt = document.getElementById('color-roseDark-text');
  if (cDark && cDarkTxt) {
    cDark.value = t.roseDark || '#78494e';
    cDarkTxt.value = t.roseDark || '#78494e';
  }
  const cSoft = document.getElementById('color-roseSoft');
  const cSoftTxt = document.getElementById('color-roseSoft-text');
  if (cSoft && cSoftTxt) {
    cSoft.value = t.roseSoft || '#e9d4cf';
    cSoftTxt.value = t.roseSoft || '#e9d4cf';
  }
}

// Renderiza toda a página com base em siteData
function renderAll() {
  // 1. Campos de texto simples [data-editable]
  document.querySelectorAll('[data-editable]').forEach(el => {
    const path = el.getAttribute('data-editable');
    const val = getNestedValue(siteData, path);
    if (val !== undefined && val !== null) {
      el.textContent = val;
    }
    el.contentEditable = isEditMode ? 'true' : 'false';
  });

  // 2. Foto Principal (Hero) + Enquadramento (Posição X/Y e Zoom)
  const heroImg = document.getElementById('hero-photo-img');
  if (heroImg) {
    heroImg.onerror = () => {
      if (siteData.hero.photoFallback && heroImg.src !== siteData.hero.photoFallback) {
        heroImg.src = siteData.hero.photoFallback;
      }
    };
    heroImg.src = siteData.hero.photoUrl || siteData.hero.photoFallback;
    applyHeroFramingStyle();
  }

  const heroContainer = document.getElementById('hero-photo-container');
  if (heroContainer) {
    heroContainer.style.cursor = isEditMode ? 'grab' : 'default';
  }

  // 3. Link do Google Maps
  const mapsLink = document.getElementById('maps-external-link');
  if (mapsLink) {
    mapsLink.href = siteData.celebration.mapsUrl || 'https://maps.app.goo.gl/38zUL1h6aSQU4DqU8';
  }

  // 4. Galeria de Fotos do Casal (Nossa História)
  renderCouplePhotos();

  // 5. Sugestões de Hospedagem
  renderLodging();

  // 6. Maquiadoras e Cabeleireiras
  renderBeauty();

  // 7. Catálogo de Presentes (50 itens)
  populateGiftCategories();
  renderGiftsList();

  // 8. Badges do Carrinho e RSVP
  updateCartBadges();
  updateRsvpBadge();
}

function applyHeroFramingStyle() {
  const heroImg = document.getElementById('hero-photo-img');
  if (!heroImg) return;
  const posX = siteData.hero.posX !== undefined ? Number(siteData.hero.posX) : 50;
  const posY = siteData.hero.posY !== undefined ? Number(siteData.hero.posY) : 35;
  const zoom = siteData.hero.zoom !== undefined ? Number(siteData.hero.zoom) : 100;
  heroImg.style.objectPosition = `${posX}% ${posY}%`;
  heroImg.style.transformOrigin = `${posX}% ${posY}%`;
  heroImg.style.transform = `scale(${zoom / 100})`;

  const slider = document.getElementById('hero-zoom-slider');
  if (slider) slider.value = zoom;
}

// Configura eventos de edição inline para campos [data-editable]
function setupEditableListeners() {
  document.querySelectorAll('[data-editable]').forEach(el => {
    el.addEventListener('blur', () => {
      if (!isEditMode) return;
      const path = el.getAttribute('data-editable');
      const newVal = el.innerText.trim();
      setNestedValue(siteData, path, newVal);
      saveSiteData(false);
    });
  });
}

function initMap() {
  // Mapa removido conforme solicitado; mantido apenas o botão direto para o Google Maps
}

function promptMapSettings() {
  const newUrl = prompt('Cole o link de localização do Google Maps:', siteData.celebration.mapsUrl || 'https://maps.app.goo.gl/38zUL1h6aSQU4DqU8');
  if (newUrl !== null && newUrl.trim() !== '') {
    siteData.celebration.mapsUrl = newUrl.trim();
    renderAll();
    saveSiteData(true);
  }
}

// ============================================================================
// ARRASTE E AJUSTE DE POSIÇÃO / ZOOM DAS FOTOS (HERO E GALERIA DO CASAL)
// ============================================================================
let dragState = null;

function startPhotoDrag(event, target) {
  if (!isEditMode) return;
  // Ignora cliques em botões ou sliders internos
  if (event.target.closest('button') || event.target.closest('input') || event.target.closest('select')) {
    return;
  }
  event.preventDefault();

  const clientX = event.touches ? event.touches[0].clientX : event.clientX;
  const clientY = event.touches ? event.touches[0].clientY : event.clientY;

  let obj = target === 'hero' ? siteData.hero : siteData.story.photos[target];
  if (!obj) return;

  if (obj.posX === undefined) obj.posX = 50;
  if (obj.posY === undefined) obj.posY = 35;

  dragState = {
    target,
    startX: clientX,
    startY: clientY,
    initialPosX: Number(obj.posX),
    initialPosY: Number(obj.posY)
  };

  window.addEventListener('mousemove', onPhotoDragMove);
  window.addEventListener('mouseup', endPhotoDrag);
  window.addEventListener('touchmove', onPhotoDragMove, { passive: false });
  window.addEventListener('touchend', endPhotoDrag);
}

function onPhotoDragMove(event) {
  if (!dragState) return;
  if (event.cancelable) event.preventDefault();

  const clientX = event.touches ? event.touches[0].clientX : event.clientX;
  const clientY = event.touches ? event.touches[0].clientY : event.clientY;

  const deltaX = clientX - dragState.startX;
  const deltaY = clientY - dragState.startY;

  // Arrastar para baixo move o foco para cima na imagem (comportamento natural de arrastar foto)
  const sensitivity = 0.22;
  const newPosX = Math.max(0, Math.min(100, Math.round(dragState.initialPosX - deltaX * sensitivity)));
  const newPosY = Math.max(0, Math.min(100, Math.round(dragState.initialPosY - deltaY * sensitivity)));

  if (dragState.target === 'hero') {
    siteData.hero.posX = newPosX;
    siteData.hero.posY = newPosY;
    applyHeroFramingStyle();
  } else {
    const idx = dragState.target;
    const photo = siteData.story.photos[idx];
    if (photo) {
      photo.posX = newPosX;
      photo.posY = newPosY;
      const imgEl = document.getElementById(`couple-photo-img-${idx}`);
      if (imgEl) {
        const zoom = photo.zoom || 100;
        imgEl.style.objectPosition = `${newPosX}% ${newPosY}%`;
        imgEl.style.transformOrigin = `${newPosX}% ${newPosY}%`;
        imgEl.style.transform = `scale(${zoom / 100})`;
      }
    }
  }
}

function endPhotoDrag() {
  if (!dragState) return;
  dragState = null;
  window.removeEventListener('mousemove', onPhotoDragMove);
  window.removeEventListener('mouseup', endPhotoDrag);
  window.removeEventListener('touchmove', onPhotoDragMove);
  window.removeEventListener('touchend', endPhotoDrag);
  saveSiteData(false);
}

function nudgePhoto(target, dx, dy) {
  const obj = target === 'hero' ? siteData.hero : siteData.story.photos[target];
  if (!obj) return;
  obj.posX = Math.max(0, Math.min(100, (obj.posX !== undefined ? Number(obj.posX) : 50) + dx));
  obj.posY = Math.max(0, Math.min(100, (obj.posY !== undefined ? Number(obj.posY) : 35) + dy));
  if (target === 'hero') {
    applyHeroFramingStyle();
  } else {
    renderCouplePhotos();
  }
  saveSiteData(false);
}

function updatePhotoZoom(target, zoomVal) {
  const z = Math.max(100, Math.min(220, Number(zoomVal) || 100));
  if (target === 'hero') {
    siteData.hero.zoom = z;
    applyHeroFramingStyle();
  } else {
    const photo = siteData.story.photos[target];
    if (photo) {
      photo.zoom = z;
      const imgEl = document.getElementById(`couple-photo-img-${target}`);
      if (imgEl) {
        const posX = photo.posX !== undefined ? photo.posX : 50;
        const posY = photo.posY !== undefined ? photo.posY : 35;
        imgEl.style.transformOrigin = `${posX}% ${posY}%`;
        imgEl.style.transform = `scale(${z / 100})`;
      }
    }
  }
  saveSiteData(false);
}

function resetPhotoFraming(target) {
  const obj = target === 'hero' ? siteData.hero : siteData.story.photos[target];
  if (!obj) return;
  obj.posX = 50;
  obj.posY = 35;
  obj.zoom = 100;
  if (target === 'hero') {
    applyHeroFramingStyle();
  } else {
    renderCouplePhotos();
  }
  saveSiteData(true);
}

// ============================================================================
// GALERIA DE FOTOS DO CASAL (NOSSA HISTÓRIA) & CONTROLE DE QUANTIDADE
// ============================================================================
const DEFAULT_SAMPLE_PHOTOS = [
  'https://cdn-assets-legacy.casar.com/dados/sitenoivos/wed1567024/paginas/A1CQr_1794757322.jpg',
  'https://cdn-assets-legacy.casar.com/dados/sitenoivos/wed1567024/paginas/e2Wdq_1794757331.jpg',
  'https://cdn-assets-legacy.casar.com/dados/sitenoivos/wed1567024/paginas/RzZ2s_1794754704.jpg',
  'https://cdn-assets-legacy.casar.com/dados/sitenoivos/wed1567024/paginas/v1XhF_1794757347.jpg',
  'https://cdn-assets-legacy.casar.com/dados/sitenoivos/wed1567024/paginas/Z4cIu_1794757511.jpg',
  'https://cdn-assets-legacy.casar.com/dados/sitenoivos/wed1567024/paginas/0tFSQ_1794757638.jpg',
  'https://cdn-assets-legacy.casar.com/dados/sitenoivos/wed1567024/paginas/r9eBj_1794757684.jpg',
  'https://cdn-assets-legacy.casar.com/dados/sitenoivos/wed1567024/paginas/6UkXj_1794754673.jpg'
];

function changePhotoSlotCount(delta) {
  if (!Array.isArray(siteData.story.photos)) siteData.story.photos = [];
  if (delta > 0) {
    for (let i = 0; i < delta; i++) {
      const nextIdx = siteData.story.photos.length;
      const sampleUrl = DEFAULT_SAMPLE_PHOTOS[nextIdx % DEFAULT_SAMPLE_PHOTOS.length];
      siteData.story.photos.push({
        id: 'photo-' + Date.now() + '-' + nextIdx,
        url: sampleUrl,
        fallback: sampleUrl,
        caption: `Abel & Beatriz (${nextIdx + 1})`,
        arch: true,
        posX: 50,
        posY: 35,
        zoom: 100
      });
    }
  } else if (delta < 0 && siteData.story.photos.length > 1) {
    siteData.story.photos.pop();
  }
  renderCouplePhotos();
  saveSiteData(true);
}

function promptSetPhotoCount() {
  const current = (siteData.story.photos || []).length;
  const raw = prompt('Quantas fotos você deseja exibir na galeria do casal?', String(current));
  if (raw === null) return;
  const target = parseInt(raw, 10);
  if (isNaN(target) || target < 1 || target > 60) {
    alert('Informe um número entre 1 e 60.');
    return;
  }
  const diff = target - current;
  if (diff > 0) {
    changePhotoSlotCount(diff);
  } else if (diff < 0) {
    if (!confirm(`Isso removerá as últimas ${Math.abs(diff)} foto(s) da galeria. Confirmar?`)) return;
    siteData.story.photos.splice(target);
    renderCouplePhotos();
    saveSiteData(true);
  }
}

function updateStoryColumns(cols) {
  siteData.story.columns = parseInt(cols, 10) || 2;
  renderCouplePhotos();
  saveSiteData(true);
}

function renderCouplePhotos() {
  const grid = document.getElementById('couple-photos-grid');
  if (!grid) return;

  const photos = siteData.story.photos || [];
  const countDisplay = document.getElementById('photo-count-display');
  if (countDisplay) countDisplay.textContent = photos.length;

  const cols = Number(siteData.story.columns) || 2;
  const colsSelect = document.getElementById('story-columns-select');
  if (colsSelect) colsSelect.value = String(cols);

  const colClass =
    cols === 4
      ? 'grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6'
      : cols === 3
      ? 'grid sm:grid-cols-2 lg:grid-cols-3 gap-7'
      : 'grid sm:grid-cols-2 lg:grid-cols-2 gap-8';
  grid.className = colClass;

  const cardsHtml = photos
    .map((photo, idx) => {
      const frameClass = photo.arch !== false ? 'arch-frame' : 'rect-frame';
      const safeUrl = photo.url || photo.fallback || '';
      const safeFallback = photo.fallback || safeUrl;
      const posX = photo.posX !== undefined ? Number(photo.posX) : 50;
      const posY = photo.posY !== undefined ? Number(photo.posY) : 35;
      const zoom = photo.zoom !== undefined ? Number(photo.zoom) : 100;

      return `
      <div class="flex flex-col group">
        <div
          class="${frameClass} relative aspect-[4/3] w-full bg-[#e9d4cf] select-none ${isEditMode ? 'cursor-grab active:cursor-grabbing' : ''}"
          onmousedown="startPhotoDrag(event, ${idx})"
          ontouchstart="startPhotoDrag(event, ${idx})"
        >
          <img
            id="couple-photo-img-${idx}"
            src="${safeUrl}"
            draggable="false"
            style="object-position: ${posX}% ${posY}%; transform-origin: ${posX}% ${posY}%; transform: scale(${zoom / 100});"
            onerror="if(this.src !== '${safeFallback}') this.src='${safeFallback}';"
            alt="${(photo.caption || `Foto ${idx + 1}`).replace(/"/g, '&quot;')}"
            onclick="if(!isEditMode) openLightbox('${safeUrl.replace(/'/g, "\\'")}', '${(photo.caption || '').replace(/'/g, "\\'")}')"
            class="w-full h-full object-cover transition-transform duration-75 ${!isEditMode ? 'cursor-zoom-in' : ''}"
          />

          ${
            isEditMode
              ? `
            <div class="absolute top-3 left-1/2 -translate-x-1/2 bg-black/65 text-[#fffaf6] px-2.5 py-0.5 rounded-full font-work text-[10px] pointer-events-none z-10 whitespace-nowrap">
              ✋ Arraste para posicionar
            </div>
          `
              : ''
          }

          <!-- Botões de Edição e Enquadramento sobre cada foto -->
          <div
            class="${isEditMode ? 'flex' : 'hidden'} absolute inset-x-0 bottom-0 bg-black/75 backdrop-blur-xs p-2.5 flex-col gap-2 z-10 font-work text-xs text-white"
            onmousedown="event.stopPropagation()"
            ontouchstart="event.stopPropagation()"
          >
            <div class="flex flex-wrap items-center justify-center gap-1.5">
              <button type="button" onclick="triggerReplaceCouplePhoto(${idx})" class="px-2.5 py-1 rounded bg-white text-[#453334] font-semibold hover:bg-[#faf5ef]">
                📷 Trocar
              </button>
              <button type="button" onclick="togglePhotoArch(${idx})" class="px-2 py-1 rounded bg-[#ad6f72] text-white font-medium hover:bg-[#78494e]" title="Alternar formato em arco ou retangular">
                ${photo.arch !== false ? '🏛️ Arco' : '🖼️ Ret.'}
              </button>
              <button type="button" onclick="nudgePhoto(${idx}, 0, -6)" class="px-1.5 py-1 rounded bg-white/20 hover:bg-white/30" title="Subir foco">⬆</button>
              <button type="button" onclick="nudgePhoto(${idx}, 0, 6)" class="px-1.5 py-1 rounded bg-white/20 hover:bg-white/30" title="Descer foco">⬇</button>
              <button type="button" onclick="nudgePhoto(${idx}, -6, 0)" class="px-1.5 py-1 rounded bg-white/20 hover:bg-white/30" title="Esquerda">⬅</button>
              <button type="button" onclick="nudgePhoto(${idx}, 6, 0)" class="px-1.5 py-1 rounded bg-white/20 hover:bg-white/30" title="Direita">➡</button>
              ${idx > 0 ? `<button type="button" onclick="moveCouplePhoto(${idx}, -1)" class="px-1.5 py-1 rounded bg-white/90 text-[#453334]" title="Mover ordem para trás">◀</button>` : ''}
              ${idx < photos.length - 1 ? `<button type="button" onclick="moveCouplePhoto(${idx}, 1)" class="px-1.5 py-1 rounded bg-white/90 text-[#453334]" title="Mover ordem para frente">▶</button>` : ''}
              <button type="button" onclick="removeCouplePhoto(${idx})" class="px-2 py-1 rounded bg-red-700 text-white font-medium hover:bg-red-800" title="Remover foto">
                🗑️
              </button>
            </div>
            <div class="flex items-center justify-center gap-2 text-[10px]">
              <span>🔍 Zoom:</span>
              <input type="range" min="100" max="200" step="2" value="${zoom}" oninput="updatePhotoZoom(${idx}, this.value)" class="w-24 accent-[#ad6f72] cursor-pointer" />
              <button type="button" onclick="resetPhotoFraming(${idx})" class="px-1.5 py-0.5 rounded bg-white/15 hover:bg-white/25">Resetar</button>
            </div>
          </div>
        </div>

        <p
          contenteditable="${isEditMode ? 'true' : 'false'}"
          onblur="updateCouplePhotoCaption(${idx}, this.innerText)"
          class="text-center text-[#594849] mt-3 text-base italic ${isEditMode ? 'outline-dashed outline-1 outline-[#ad6f72] px-2 py-1 rounded' : ''}"
        >${photo.caption || ''}</p>
      </div>
    `;
    })
    .join('');

  // Card extra no Modo Edição para adicionar mais fotos facilmente
  const addCardHtml = isEditMode
    ? `
    <div class="flex flex-col">
      <div class="arch-frame relative aspect-[4/3] w-full bg-[#faf5ef] border-2 border-dashed border-[#ad6f72] flex flex-col items-center justify-center p-6 text-center gap-3">
        <div class="text-4xl text-[#ad6f72]">📷</div>
        <h4 class="text-lg font-medium text-[#78494e]">Adicionar Mais Fotos</h4>
        <div class="flex flex-wrap items-center justify-center gap-2 font-work text-xs">
          <button type="button" onclick="triggerCouplePhotoUpload()" class="btn-rose px-4 py-2 rounded font-medium shadow-xs">
            + Enviar do Dispositivo
          </button>
          <button type="button" onclick="changePhotoSlotCount(1)" class="btn-outline-rose bg-white px-3 py-2 rounded font-medium">
            + Novo Espaço
          </button>
        </div>
      </div>
    </div>
  `
    : '';

  grid.innerHTML = cardsHtml + addCardHtml;
}

function updateCouplePhotoCaption(index, text) {
  if (!siteData.story.photos[index]) return;
  siteData.story.photos[index].caption = text.trim();
  saveSiteData(false);
}

function togglePhotoArch(index) {
  if (!siteData.story.photos[index]) return;
  siteData.story.photos[index].arch = siteData.story.photos[index].arch === false ? true : false;
  renderCouplePhotos();
  saveSiteData(true);
}

function moveCouplePhoto(index, direction) {
  const photos = siteData.story.photos;
  const target = index + direction;
  if (target < 0 || target >= photos.length) return;
  const temp = photos[index];
  photos[index] = photos[target];
  photos[target] = temp;
  renderCouplePhotos();
  saveSiteData(true);
}

function removeCouplePhoto(index) {
  if (!confirm('Deseja remover esta foto da galeria do casal?')) return;
  siteData.story.photos.splice(index, 1);
  renderCouplePhotos();
  saveSiteData(true);
}

// Compressão inteligente de imagem via Canvas para salvar localmente sem estourar limite
function compressImageFile(file, maxWidth = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > maxWidth) {
          h = Math.round((h * maxWidth) / w);
          w = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function triggerHeroPhotoUpload() {
  document.getElementById('hero-file-input').click();
}

async function handleHeroFileSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    const dataUrl = await compressImageFile(file, 1300, 0.85);
    siteData.hero.photoUrl = dataUrl;
    siteData.hero.photoFallback = dataUrl;
    renderAll();
    saveSiteData(true);
  } catch (err) {
    alert('Não foi possível carregar a imagem selecionada.');
  }
  event.target.value = '';
}

function promptHeroPhotoUrl() {
  const url = prompt('Cole o link (URL) da foto principal do casal:', siteData.hero.photoUrl || '');
  if (url && url.trim()) {
    siteData.hero.photoUrl = url.trim();
    siteData.hero.photoFallback = url.trim();
    renderAll();
    saveSiteData(true);
  }
}

function triggerCouplePhotoUpload() {
  document.getElementById('couple-file-input').click();
}

async function handleCoupleFilesSelected(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  for (const file of files) {
    try {
      const dataUrl = await compressImageFile(file, 1200, 0.82);
      siteData.story.photos.push({
        id: 'photo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        url: dataUrl,
        fallback: dataUrl,
        caption: 'Abel & Beatriz',
        arch: true,
        posX: 50,
        posY: 35,
        zoom: 100
      });
    } catch (e) {
      console.error(e);
    }
  }
  renderCouplePhotos();
  saveSiteData(true);
  event.target.value = '';
}

function promptAddCouplePhotoUrl() {
  const url = prompt('Cole o link (URL) da nova foto do casal:');
  if (!url || !url.trim()) return;
  const caption = prompt('Legenda da foto (opcional):', 'Abel & Beatriz') || '';
  siteData.story.photos.push({
    id: 'photo-' + Date.now(),
    url: url.trim(),
    fallback: url.trim(),
    caption: caption.trim(),
    arch: true,
    posX: 50,
    posY: 35,
    zoom: 100
  });
  renderCouplePhotos();
  saveSiteData(true);
}

function triggerReplaceCouplePhoto(index) {
  replacePhotoTargetIndex = index;
  document.getElementById('replace-couple-file-input').click();
}

async function handleReplaceCoupleFileSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file || replacePhotoTargetIndex === null) return;
  try {
    const dataUrl = await compressImageFile(file, 1200, 0.82);
    if (siteData.story.photos[replacePhotoTargetIndex]) {
      siteData.story.photos[replacePhotoTargetIndex].url = dataUrl;
      siteData.story.photos[replacePhotoTargetIndex].fallback = dataUrl;
      renderCouplePhotos();
      saveSiteData(true);
    }
  } catch (e) {
    alert('Erro ao substituir foto.');
  }
  replacePhotoTargetIndex = null;
  event.target.value = '';
}

function openLightbox(url, caption) {
  const modal = document.getElementById('lightbox-modal');
  const img = document.getElementById('lightbox-img');
  const cap = document.getElementById('lightbox-caption');
  if (!modal || !img) return;
  img.src = url;
  if (cap) cap.textContent = caption || '';
  modal.classList.remove('hidden');
}

function closeLightbox() {
  const modal = document.getElementById('lightbox-modal');
  if (modal) modal.classList.add('hidden');
}

// ============================================================================
// GUIA DE HOSPEDAGEM
// ============================================================================
function renderLodging() {
  const grid = document.getElementById('lodging-grid');
  if (!grid) return;

  const items = siteData.lodging.items || [];
  grid.innerHTML = items
    .map(
      (item, idx) => `
    <article class="bg-[#fffdfb] border border-[#e8d9d1] rounded-[4px] p-7 md:p-8 shadow-sm flex flex-col justify-between relative">
      ${
        isEditMode
          ? `<button type="button" onclick="removeLodgingItem(${idx})" class="absolute top-3 right-3 text-xs bg-red-100 hover:bg-red-200 text-red-800 px-2.5 py-1 rounded font-work">🗑️ Excluir</button>`
          : ''
      }
      <div>
        <div
          contenteditable="${isEditMode ? 'true' : 'false'}"
          onblur="updateLodgingField(${idx}, 'icon', this.innerText)"
          class="text-3xl text-[var(--rose)] mb-4 inline-block"
        >${item.icon || '⌂'}</div>

        <p
          contenteditable="${isEditMode ? 'true' : 'false'}"
          onblur="updateLodgingField(${idx}, 'category', this.innerText)"
          class="eyebrow text-[var(--rose)] mb-2 text-[0.7rem]"
        >${item.category || ''}</p>

        <h3
          contenteditable="${isEditMode ? 'true' : 'false'}"
          onblur="updateLodgingField(${idx}, 'name', this.innerText)"
          class="text-[var(--rose-dark)] font-semibold mb-3 text-xl md:text-[1.35rem]"
        >${item.name || ''}</h3>

        <p
          contenteditable="${isEditMode ? 'true' : 'false'}"
          onblur="updateLodgingField(${idx}, 'description', this.innerText)"
          class="text-[#594849] text-[1.05rem] leading-relaxed mb-4"
        >${item.description || ''}</p>
      </div>

      <div class="pt-4 border-t border-[#f2e5dc] mt-2 space-y-2">
        <p
          contenteditable="${isEditMode ? 'true' : 'false'}"
          onblur="updateLodgingField(${idx}, 'info', this.innerText)"
          class="text-xs font-work text-[#756264]"
        >✨ ${item.info || ''}</p>

        <p
          contenteditable="${isEditMode ? 'true' : 'false'}"
          onblur="updateLodgingField(${idx}, 'contact', this.innerText)"
          class="text-xs font-work text-[#453334] font-medium"
        >📞 ${item.contact || ''}</p>

        <div class="pt-2 flex flex-wrap items-center gap-2">
          <a href="${item.link || '#'}" target="_blank" rel="noopener noreferrer" class="inline-block btn-outline-rose px-4 py-2 rounded-[3px] text-[11px] uppercase tracking-[0.14em] font-semibold no-underline">
            ${item.linkText || 'Ver Localização / Contato'}
          </a>
          ${
            isEditMode
              ? `<button type="button" onclick="promptLodgingLink(${idx})" class="px-2.5 py-1.5 rounded bg-[#f2e5dc] text-[#78494e] font-work text-xs">🔗 Editar Link</button>`
              : ''
          }
        </div>
      </div>
    </article>
  `
    )
    .join('');
}

function updateLodgingField(idx, field, val) {
  if (!siteData.lodging.items[idx]) return;
  siteData.lodging.items[idx][field] = val.replace(/^[✨📞]\s*/, '').trim();
  saveSiteData(false);
}

function promptLodgingLink(idx) {
  const item = siteData.lodging.items[idx];
  if (!item) return;
  const link = prompt('Link do Hotel/Pousada (Google Maps, WhatsApp ou Site):', item.link || '');
  if (link !== null) item.link = link.trim();
  const label = prompt('Texto do botão:', item.linkText || 'Ver no Mapa');
  if (label !== null && label.trim()) item.linkText = label.trim();
  renderLodging();
  saveSiteData(true);
}

function addLodgingItem() {
  siteData.lodging.items.push({
    id: 'lodging-' + Date.now(),
    icon: '⌂',
    name: 'Novo Local de Hospedagem',
    category: 'Pindaí / Região',
    description: 'Clique para editar a descrição, distância e comodidades deste local.',
    info: 'Café da manhã · Wi-Fi · Estacionamento',
    contact: '(77) 99999-0000',
    link: 'https://www.google.com/maps',
    linkText: 'Ver no Mapa'
  });
  renderLodging();
  saveSiteData(true);
}

function removeLodgingItem(idx) {
  if (!confirm('Remover esta sugestão de hospedagem?')) return;
  siteData.lodging.items.splice(idx, 1);
  renderLodging();
  saveSiteData(true);
}

// ============================================================================
// GUIA DE MAQUIADORAS E CABELEIREIRAS
// ============================================================================
function renderBeauty() {
  const grid = document.getElementById('beauty-grid');
  if (!grid) return;

  const items = siteData.beauty.items || [];
  grid.innerHTML = items
    .map(
      (item, idx) => `
    <article class="bg-[#fffdfb] border border-[#e8d9d1] rounded-[4px] p-7 md:p-8 shadow-sm flex flex-col justify-between relative">
      ${
        isEditMode
          ? `<button type="button" onclick="removeBeautyItem(${idx})" class="absolute top-3 right-3 text-xs bg-red-100 hover:bg-red-200 text-red-800 px-2.5 py-1 rounded font-work">🗑️ Excluir</button>`
          : ''
      }
      <div>
        <div
          contenteditable="${isEditMode ? 'true' : 'false'}"
          onblur="updateBeautyField(${idx}, 'icon', this.innerText)"
          class="text-3xl text-[var(--rose)] mb-4 inline-block"
        >${item.icon || '✧'}</div>

        <p
          contenteditable="${isEditMode ? 'true' : 'false'}"
          onblur="updateBeautyField(${idx}, 'specialty', this.innerText)"
          class="eyebrow text-[var(--rose)] mb-2 text-[0.7rem]"
        >${item.specialty || ''}</p>

        <h3
          contenteditable="${isEditMode ? 'true' : 'false'}"
          onblur="updateBeautyField(${idx}, 'name', this.innerText)"
          class="text-[var(--rose-dark)] font-semibold mb-3 text-xl md:text-[1.35rem]"
        >${item.name || ''}</h3>

        <p
          contenteditable="${isEditMode ? 'true' : 'false'}"
          onblur="updateBeautyField(${idx}, 'description', this.innerText)"
          class="text-[#594849] text-[1.05rem] leading-relaxed mb-4"
        >${item.description || ''}</p>
      </div>

      <div class="pt-4 border-t border-[#f2e5dc] mt-2 space-y-2">
        <p
          contenteditable="${isEditMode ? 'true' : 'false'}"
          onblur="updateBeautyField(${idx}, 'info', this.innerText)"
          class="text-xs font-work text-[#756264]"
        >💄 ${item.info || ''}</p>

        <div class="flex items-center justify-between text-xs font-work text-[#453334] font-medium">
          <span
            contenteditable="${isEditMode ? 'true' : 'false'}"
            onblur="updateBeautyField(${idx}, 'contact', this.innerText)"
          >📱 ${item.contact || ''}</span>
          <span
            contenteditable="${isEditMode ? 'true' : 'false'}"
            onblur="updateBeautyField(${idx}, 'instagram', this.innerText)"
            class="text-[var(--rose-dark)]"
          >${item.instagram || ''}</span>
        </div>

        <div class="pt-2 flex flex-wrap items-center gap-2">
          <a href="${item.link || '#'}" target="_blank" rel="noopener noreferrer" class="inline-block btn-rose px-4 py-2 rounded-[3px] text-[11px] uppercase tracking-[0.14em] font-medium no-underline">
            Agendar / Contato
          </a>
          ${
            isEditMode
              ? `<button type="button" onclick="promptBeautyLink(${idx})" class="px-2.5 py-1.5 rounded bg-[#f2e5dc] text-[#78494e] font-work text-xs">🔗 Link WhatsApp/Insta</button>`
              : ''
          }
        </div>
      </div>
    </article>
  `
    )
    .join('');
}

function updateBeautyField(idx, field, val) {
  if (!siteData.beauty.items[idx]) return;
  siteData.beauty.items[idx][field] = val.replace(/^[💄📱]\s*/, '').trim();
  saveSiteData(false);
}

function promptBeautyLink(idx) {
  const item = siteData.beauty.items[idx];
  if (!item) return;
  const link = prompt('Link de agendamento (WhatsApp ou Instagram):', item.link || 'https://wa.me/5577999990000');
  if (link !== null) {
    item.link = link.trim();
    renderBeauty();
    saveSiteData(true);
  }
}

function addBeautyItem() {
  siteData.beauty.items.push({
    id: 'beauty-' + Date.now(),
    icon: '❀',
    name: 'Nova Profissional / Salão',
    specialty: 'Maquiagem & Penteados',
    description: 'Clique para editar os detalhes do atendimento, estilo de produção e endereço.',
    info: 'Atendimento mediante agendamento prévio',
    contact: '(77) 99999-0000',
    instagram: '@instagram',
    link: 'https://wa.me/5577999990000'
  });
  renderBeauty();
  saveSiteData(true);
}

function removeBeautyItem(idx) {
  if (!confirm('Remover esta indicação de profissional?')) return;
  siteData.beauty.items.splice(idx, 1);
  renderBeauty();
  saveSiteData(true);
}

// ============================================================================
// GUIA DE SUGESTÕES DE PRESENTES (CARDS + LISTA COMPLETA DO CASAR.COM)
// ============================================================================
function renderGiftHighlights() {
  const grid = document.getElementById('gift-highlights-grid');
  if (!grid) return;
  const highlights = siteData.giftsSection.highlights || [];
  grid.innerHTML = highlights
    .map(
      (h, idx) => `
    <article class="bg-[#fffdfb] border border-[#e8d9d1] rounded-[4px] p-7 text-center shadow-xs">
      <div
        contenteditable="${isEditMode ? 'true' : 'false'}"
        onblur="siteData.giftsSection.highlights[${idx}].icon = this.innerText.trim(); saveSiteData(false);"
        class="text-3xl text-[var(--rose)] mb-4"
      >${h.icon}</div>
      <h3
        contenteditable="${isEditMode ? 'true' : 'false'}"
        onblur="siteData.giftsSection.highlights[${idx}].title = this.innerText.trim(); saveSiteData(false);"
        class="text-[var(--rose-dark)] font-semibold mb-2 text-xl"
      >${h.title}</h3>
      <p
        contenteditable="${isEditMode ? 'true' : 'false'}"
        onblur="siteData.giftsSection.highlights[${idx}].desc = this.innerText.trim(); saveSiteData(false);"
        class="text-[#594849] text-[1.0625rem]"
      >${h.desc}</p>
    </article>
  `
    )
    .join('');
}

function populateGiftCategories() {
  const select = document.getElementById('gift-category');
  if (!select) return;
  const currentVal = select.value || 'ALL';
  const items = siteData.giftsSection.items || [];
  const counts = {};
  items.forEach(item => {
    const cat = item.category || 'Outros';
    counts[cat] = (counts[cat] || 0) + 1;
  });

  const categories = Object.keys(counts).sort();
  select.innerHTML = `<option value="ALL">Todas as categorias (${items.length})</option>` +
    categories.map(c => `<option value="${c}">${c} (${counts[c]})</option>`).join('');
  if (categories.includes(currentVal) || currentVal === 'ALL') {
    select.value = currentVal;
  }
}

function renderGiftsList() {
  const grid = document.getElementById('gifts-catalog-grid');
  const toggleBtn = document.getElementById('toggle-all-gifts-btn');
  const toggleWrap = document.getElementById('gifts-Toggle-Wrap');
  if (!grid) return;

  const searchVal = (document.getElementById('gift-search')?.value || '').toLowerCase().trim();
  const catVal = document.getElementById('gift-category')?.value || 'ALL';
  const sortVal = document.getElementById('gift-sort')?.value || 'alpha';

  let filtered = (siteData.giftsSection.items || []).map((item, originalIndex) => ({
    ...item,
    originalIndex
  }));

  if (catVal !== 'ALL') {
    filtered = filtered.filter(i => i.category === catVal);
  }
  if (searchVal) {
    filtered = filtered.filter(
      i =>
        (i.title && i.title.toLowerCase().includes(searchVal)) ||
        (i.category && i.category.toLowerCase().includes(searchVal))
    );
  }

  if (sortVal === 'price-asc') {
    filtered.sort((a, b) => Number(a.price) - Number(b.price));
  } else if (sortVal === 'price-desc') {
    filtered.sort((a, b) => Number(b.price) - Number(a.price));
  } else {
    filtered.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'pt-BR'));
  }

  const totalFiltered = filtered.length;
  const shouldSlice = !showAllGifts && !searchVal && catVal === 'ALL' && !isEditMode && totalFiltered > 12;
  const visibleItems = shouldSlice ? filtered.slice(0, 12) : filtered;

  if (toggleWrap && toggleBtn) {
    if (totalFiltered <= 12 || searchVal || catVal !== 'ALL') {
      toggleWrap.classList.add('hidden');
    } else {
      toggleWrap.classList.remove('hidden');
      toggleBtn.textContent = showAllGifts
        ? 'Mostrar menos presentes'
        : `Ver todos os ${totalFiltered} presentes da lista`;
    }
  }

  if (!visibleItems.length) {
    grid.innerHTML = `
      <div class="col-span-full bg-[#fffdfb] border border-[#e8d9d1] rounded p-10 text-center text-[#594849]">
        Nenhum presente encontrado com esse filtro.
      </div>
    `;
    return;
  }

  grid.innerHTML = visibleItems
    .map(item => {
      const installment = formatBRL(Number(item.price) / 6);
      const inCart = cart.some(c => c.id === item.id);
      return `
      <article class="bg-[#fffdfb] border border-[#e8d9d1] rounded-[4px] p-5 flex flex-col justify-between shadow-xs hover:shadow-md transition relative group">
        ${
          isEditMode
            ? `
          <div class="flex items-center justify-between gap-1 mb-2 pb-2 border-b border-[#f2e5dc] font-work text-[11px]">
            <button type="button" onclick="promptEditGiftPhoto(${item.originalIndex})" class="px-2 py-1 rounded bg-[#faf5ef] hover:bg-[#e9d4cf] text-[#78494e]">📷 Foto</button>
            <button type="button" onclick="promptEditGiftPrice(${item.originalIndex})" class="px-2 py-1 rounded bg-[#faf5ef] hover:bg-[#e9d4cf] text-[#78494e]">💲 Preço</button>
            <button type="button" onclick="removeGiftItem(${item.originalIndex})" class="px-2 py-1 rounded bg-red-100 hover:bg-red-200 text-red-800">🗑️</button>
          </div>
        `
            : ''
        }

        <div>
          <div class="w-full h-44 bg-white rounded-[3px] flex items-center justify-center p-3 mb-4 overflow-hidden border border-[#f5ebe6]">
            <img
              src="${item.img || item.imgOriginal || GIFT_PLACEHOLDER}"
              alt="${(item.title || '').replace(/"/g, '&quot;')}"
              ${item.imgOriginal ? `onerror="if(this.src!=='${item.imgOriginal}'){this.src='${item.imgOriginal}'}"` : ''}
              class="max-h-full max-w-full object-contain group-hover:scale-105 transition duration-300"
            />
          </div>

          <span class="inline-block font-work text-[10px] uppercase tracking-widest text-[var(--rose)] mb-1">
            ${item.category || 'Lista de Casamento'}
          </span>

          <h3
            contenteditable="${isEditMode ? 'true' : 'false'}"
            onblur="updateGiftTitle(${item.originalIndex}, this.innerText)"
            class="text-[#453334] font-medium text-lg leading-snug mb-2 min-h-[3.2rem]"
          >${item.title}</h3>
        </div>

        <div class="pt-3 border-t border-[#f5ebe6] mt-2">
          <div class="text-2xl font-semibold text-[var(--rose-dark)] mb-0.5">
            ${formatBRL(item.price)}
          </div>
          <div class="font-work text-[11px] text-[#756264] mb-4">
            ou em até 6x de ${installment}
          </div>

          <button
            type="button"
            onclick="addToCart(${item.id})"
            class="w-full py-2.5 px-4 rounded-[3px] font-work text-xs uppercase tracking-[0.14em] font-semibold transition ${
              inCart
                ? 'bg-[#78494e] text-white'
                : 'btn-rose'
            }"
          >
            ${inCart ? '✓ No Carrinho (Ver)' : 'Presentear'}
          </button>
        </div>
      </article>
    `;
    })
    .join('');
}

function toggleShowAllGifts() {
  showAllGifts = !showAllGifts;
  renderGiftsList();
}

function updateGiftTitle(originalIndex, newTitle) {
  if (!siteData.giftsSection.items[originalIndex]) return;
  siteData.giftsSection.items[originalIndex].title = newTitle.trim();
  saveSiteData(false);
}

function promptEditGiftPrice(originalIndex) {
  const item = siteData.giftsSection.items[originalIndex];
  if (!item) return;
  const raw = prompt(`Novo valor para "${item.title}" (ex: 250.00):`, item.price);
  if (raw !== null) {
    const parsed = parseFloat(raw.replace(',', '.'));
    if (!isNaN(parsed) && parsed >= 0) {
      item.price = parsed;
      renderGiftsList();
      saveSiteData(true);
    }
  }
}

function promptEditGiftPhoto(originalIndex) {
  const item = siteData.giftsSection.items[originalIndex];
  if (!item) return;
  const url = prompt(`URL da imagem para "${item.title}":`, item.img || '');
  if (url !== null && url.trim()) {
    item.img = url.trim();
    renderGiftsList();
    saveSiteData(true);
  }
}

function removeGiftItem(originalIndex) {
  const item = siteData.giftsSection.items[originalIndex];
  if (!item) return;
  if (!confirm(`Deseja remover "${item.title}" da lista de presentes?`)) return;
  siteData.giftsSection.items.splice(originalIndex, 1);
  populateGiftCategories();
  renderGiftsList();
  saveSiteData(true);
}

function openAddGiftModal() {
  const title = prompt('Nome do novo presente:');
  if (!title || !title.trim()) return;
  const priceRaw = prompt('Valor do presente em R$ (ex: 350,00):', '250,00');
  const price = parseFloat((priceRaw || '0').replace(/\./g, '').replace(',', '.')) || 100;
  const category = prompt('Categoria:', 'Casa Indispensáveis') || 'Casa Indispensáveis';
  const img =
    prompt(
      'Link (URL) da foto do presente:',
      'https://cdn-assets-legacy.casar.com/thumb/208x208x1/img/presentes/casa-indispensaveis/15.jpg'
    ) || 'https://cdn-assets-legacy.casar.com/thumb/208x208x1/img/presentes/casa-indispensaveis/15.jpg';

  const newId = Date.now();
  siteData.giftsSection.items.unshift({
    id: newId,
    title: title.trim(),
    price,
    category: category.trim(),
    img: img.trim()
  });
  populateGiftCategories();
  renderGiftsList();
  saveSiteData(true);
}

function openPaymentConfigModal() {
  const pix = prompt('Informe a Chave PIX do casal (CPF, E-mail, Telefone ou Chave Aleatória):', siteData.giftsSection.pixKey || '');
  if (pix !== null) {
    siteData.giftsSection.pixKey = pix.trim();
  }
  const casarUrl = prompt(
    'Link para checkout externo (ex: noivos.casar.com/beatrizoliveira-e-abelcosta):',
    siteData.giftsSection.casarUrl || 'https://noivos.casar.com/beatrizoliveira-e-abelcosta'
  );
  if (casarUrl !== null && casarUrl.trim()) {
    siteData.giftsSection.casarUrl = casarUrl.trim();
  }
  saveSiteData(true);
}

// ============================================================================
// CARRINHO DE PRESENTES (FLUXO CASAR.COM)
// ============================================================================
function addToCart(giftId) {
  const item = (siteData.giftsSection.items || []).find(i => i.id === giftId);
  if (!item) return;

  const existing = cart.find(c => c.id === giftId);
  if (!existing) {
    cart.push({
      id: item.id,
      title: item.title,
      price: item.price,
      img: item.img
    });
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  }
  updateCartBadges();
  renderGiftsList();
  openCartModal();
}

function removeFromCart(giftId) {
  cart = cart.filter(c => c.id !== giftId);
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  updateCartBadges();
  renderGiftsList();
  renderCartModalContent();
}

function updateCartBadges() {
  const count = cart.length;
  const hBadge = document.getElementById('header-cart-count');
  const gBadge = document.getElementById('gifts-bar-cart-count');
  if (hBadge) hBadge.textContent = count;
  if (gBadge) gBadge.textContent = count;
}

function openCartModal() {
  const modal = document.getElementById('cart-modal');
  if (!modal) return;
  document.getElementById('checkout-options-box')?.classList.add('hidden');
  renderCartModalContent();
  modal.classList.remove('hidden');
}

function closeCartModal() {
  const modal = document.getElementById('cart-modal');
  if (modal) modal.classList.add('hidden');
}

function renderCartModalContent() {
  const container = document.getElementById('cart-items-container');
  const totalEl = document.getElementById('cart-total-value');
  if (!container || !totalEl) return;

  if (!cart.length) {
    container.innerHTML = `
      <div class="py-10 text-center text-[#594849]">
        Seu carrinho de presentes está vazio. Escolha um item na lista para presentear Abel &amp; Beatriz!
      </div>
    `;
    totalEl.textContent = 'R$ 0,00';
    return;
  }

  const total = cart.reduce((acc, item) => acc + Number(item.price || 0), 0);
  totalEl.textContent = formatBRL(total);

  container.innerHTML = `
    <div class="flex items-center justify-between text-xs font-work uppercase tracking-wider text-[#756264] border-b border-[#e8d9d1] pb-2 mb-3">
      <span>Descrição do presente</span>
      <span>Valor</span>
    </div>
    <div class="divide-y divide-[#e8d9d1]">
      ${cart
        .map(
          item => `
        <div class="py-4 flex items-center justify-between gap-4">
          <div class="flex items-center gap-4">
            <img src="${item.img}" alt="${item.title}" class="w-16 h-16 object-contain border border-[#e8d9d1] rounded p-1 bg-white shrink-0" />
            <div>
              <h4 class="font-medium text-[#453334] text-lg leading-snug">${item.title}</h4>
              <button type="button" onclick="removeFromCart(${item.id})" class="text-xs font-work text-red-600 underline hover:text-red-800 mt-1">
                Remover
              </button>
            </div>
          </div>
          <div class="font-work font-medium text-[#453334] shrink-0">
            ${formatBRL(item.price)}
          </div>
        </div>
      `
        )
        .join('')}
    </div>
  `;
}

function showCheckoutOptions() {
  if (!cart.length) {
    alert('Adicione pelo menos um presente ao carrinho primeiro.');
    return;
  }
  const box = document.getElementById('checkout-options-box');
  const casarLink = document.getElementById('checkout-casar-link');
  const pixDisplay = document.getElementById('checkout-pix-display');
  if (casarLink) {
    casarLink.href = siteData.giftsSection.casarUrl || 'https://noivos.casar.com/beatrizoliveira-e-abelcosta';
  }
  if (pixDisplay) {
    pixDisplay.textContent =
      siteData.giftsSection.pixKey && siteData.giftsSection.pixKey !== 'Informe sua chave PIX no Modo Edição'
        ? `Chave PIX: ${siteData.giftsSection.pixKey} (Clique para copiar)`
        : 'Clique para copiar a Chave PIX do casal';
  }
  if (box) box.classList.remove('hidden');
}

function copyPixKey() {
  const key = siteData.giftsSection.pixKey || '';
  if (!key || key === 'Informe sua chave PIX no Modo Edição') {
    alert('A chave PIX ainda não foi informada pelos noivos. Você pode presentear pelo site do Casar.com (opção ao lado).');
    return;
  }
  navigator.clipboard?.writeText(key);
  alert(`Chave PIX copiada: ${key}\n\nObrigado pelo carinho com Abel & Beatriz!`);
}

// ============================================================================
// RSVP (CONFIRMAÇÃO DE PRESENÇA)
// ============================================================================
// ============================================================================
// CONFIRMAÇÃO DE PRESENÇA (RSVP) — respostas vão para uma lista privada dos noivos
// ============================================================================
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getRsvpEndpoint() {
  return ((siteData.rsvpConfig && siteData.rsvpConfig.endpoint) || '').trim();
}

// Onde as respostas são guardadas: 'google' (planilha), 'server' (node server.js) ou 'local' (só teste)
function getRsvpMode() {
  if (getRsvpEndpoint()) return 'google';
  if (window.location.protocol.startsWith('http')) return 'server';
  return 'local';
}

// Cria um campo de nome para cada acompanhante (número de pessoas - 1)
function renderCompanionFields() {
  const wrap = document.getElementById('companions-wrap');
  const fields = document.getElementById('companions-fields');
  if (!wrap || !fields) return;

  const count = Math.min(20, Math.max(1, parseInt(document.getElementById('guest-count').value, 10) || 1));
  const attendance = document.getElementById('attendance').value;
  const needed = attendance === 'Não' ? 0 : count - 1;

  // Preserva o que já foi digitado
  const current = Array.from(fields.querySelectorAll('input')).map(i => i.value);

  if (needed <= 0) {
    wrap.classList.add('hidden');
    fields.innerHTML = '';
    return;
  }

  fields.innerHTML = Array.from({ length: needed })
    .map(
      (_, i) => `
      <input type="text" maxlength="100" required class="field companion-name"
        placeholder="Acompanhante ${i + 1} — nome completo"
        aria-label="Nome do acompanhante ${i + 1}"
        value="${escapeHtml(current[i] || '')}" />`
    )
    .join('');
  wrap.classList.remove('hidden');
}

async function sendRsvp(entry) {
  const mode = getRsvpMode();

  if (mode === 'google') {
    // O Google Apps Script não devolve cabeçalhos CORS no POST; 'no-cors' envia normalmente.
    await fetch(getRsvpEndpoint(), {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(entry)
    });
    return;
  }

  if (mode === 'server') {
    const resp = await fetch('/api/rsvp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    });
    if (!resp.ok) throw new Error('Servidor respondeu ' + resp.status);
    return;
  }

  // Modo teste (arquivo aberto no computador, sem planilha configurada)
  if (!Array.isArray(siteData.rsvpSubmissions)) siteData.rsvpSubmissions = [];
  siteData.rsvpSubmissions.unshift(entry);
  await saveSiteData(false);
}

async function handleRsvpSubmit(event) {
  event.preventDefault();
  const name = document.getElementById('guest-name').value.trim();
  const attendance = document.getElementById('attendance').value;
  const message = document.getElementById('guest-message').value.trim();
  const companions = Array.from(document.querySelectorAll('#companions-fields .companion-name'))
    .map(i => i.value.trim())
    .filter(Boolean);
  const count =
    attendance === 'Não' ? 0 : Math.max(1, parseInt(document.getElementById('guest-count').value, 10) || 1);

  if (!name || !attendance) return;

  const entry = {
    id: Date.now(),
    name,
    attendance,
    count,
    companions,
    message,
    createdAt: new Date().toLocaleString('pt-BR')
  };

  const btn = document.getElementById('submit-rsvp');
  const feedback = document.getElementById('rsvp-feedback');
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = '0.6';
  }

  try {
    await sendRsvp(entry);
    if (feedback) {
      const extra = companions.length ? ` com ${companions.join(', ')}` : '';
      feedback.textContent =
        attendance === 'Sim'
          ? `Obrigado, ${name}! Sua presença${extra} foi confirmada (${count} pessoa${count > 1 ? 's' : ''}). Estamos muito felizes em celebrar com você!`
          : `Obrigado por nos avisar, ${name}. Sentiremos sua falta!`;
      feedback.className = 'p-4 rounded bg-[#f2e5dc] border border-[#ad6f72] text-[#78494e] font-work text-sm';
    }
    document.getElementById('rsvp-form').reset();
    document.getElementById('guest-count').value = '1';
    renderCompanionFields();
  } catch (err) {
    console.warn('Falha ao enviar RSVP:', err);
    if (feedback) {
      feedback.textContent =
        'Não foi possível enviar sua resposta agora. Verifique sua internet e tente novamente, ou avise os noivos diretamente.';
      feedback.className = 'p-4 rounded bg-red-50 border border-red-300 text-red-800 font-work text-sm';
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = '';
    }
  }
}

function updateRsvpBadge() {
  /* A contagem agora fica na lista privada (protegida por senha). */
}

let lastRsvpRows = [];

function openRsvpAdminModal() {
  const modal = document.getElementById('rsvp-admin-modal');
  const info = document.getElementById('rsvp-source-info');
  const endpointInput = document.getElementById('rsvp-endpoint-input');
  if (!modal) return;

  const mode = getRsvpMode();
  if (info) {
    info.innerHTML =
      mode === 'google'
        ? '✅ As respostas estão sendo guardadas na sua <strong>Planilha Google</strong> (só vocês dois têm acesso). Digite a senha para ver a lista aqui ou abra a planilha direto no Google Drive.'
        : mode === 'server'
        ? 'As respostas estão sendo guardadas no servidor (<code>node server.js</code>), no arquivo <strong>rsvps.json</strong>. Digite a senha para ver a lista.'
        : '⚠️ <strong>Modo teste:</strong> a planilha ainda não foi configurada, então as respostas ficam só neste navegador e os convidados não conseguem enviar para vocês. Configure o Google Planilhas abaixo (no Modo de Edição).';
  }
  if (endpointInput) endpointInput.value = getRsvpEndpoint();

  if (mode === 'local') {
    renderRsvpRows((siteData.rsvpSubmissions || []).map(normalizeRsvpRow));
  } else if (!lastRsvpRows.length) {
    document.getElementById('rsvp-submissions-list').innerHTML = '';
  }
  modal.classList.remove('hidden');
}

function normalizeRsvpRow(r) {
  const companions = Array.isArray(r.companions)
    ? r.companions
    : String(r.companions || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
  return {
    createdAt: r.createdAt || '',
    name: r.name || '',
    attendance: r.attendance || '',
    count: Number(r.count) || 0,
    companions,
    message: r.message || ''
  };
}

async function loadRsvpList(event) {
  if (event) event.preventDefault();
  const list = document.getElementById('rsvp-submissions-list');
  const key = (document.getElementById('rsvp-admin-key').value || '').trim();
  const mode = getRsvpMode();

  if (mode === 'local') {
    renderRsvpRows((siteData.rsvpSubmissions || []).map(normalizeRsvpRow));
    return;
  }
  if (!key) {
    list.innerHTML = '<p class="text-red-700 py-3">Digite a senha da lista.</p>';
    return;
  }

  list.innerHTML = '<p class="text-[#594849] py-4 text-center">Carregando lista…</p>';
  try {
    const url =
      mode === 'google'
        ? `${getRsvpEndpoint()}?action=list&key=${encodeURIComponent(key)}`
        : `/api/rsvps?key=${encodeURIComponent(key)}`;
    const resp = await fetch(url, { cache: 'no-store' });
    const data = await resp.json();
    if (!data.ok) {
      list.innerHTML = '<p class="text-red-700 py-3">Senha incorreta.</p>';
      return;
    }
    renderRsvpRows((data.rows || []).map(normalizeRsvpRow));
  } catch (err) {
    list.innerHTML =
      '<p class="text-red-700 py-3">Não foi possível carregar a lista. Confira o link da planilha e a sua internet.</p>';
  }
}

function renderRsvpRows(rows) {
  const list = document.getElementById('rsvp-submissions-list');
  lastRsvpRows = rows;
  if (!rows.length) {
    list.innerHTML = '<p class="text-[#594849] py-6 text-center">Nenhuma confirmação de presença recebida ainda.</p>';
    return;
  }
  const yes = rows.filter(r => r.attendance === 'Sim');
  const totalPeople = yes.reduce((acc, r) => acc + (r.count || 1), 0);
  const noCount = rows.length - yes.length;

  list.innerHTML = `
    <div class="grid grid-cols-3 gap-2 mb-2 text-center">
      <div class="p-3 rounded bg-emerald-50 border border-emerald-200"><div class="text-2xl font-semibold text-emerald-800">${totalPeople}</div><div class="text-emerald-800">pessoas confirmadas</div></div>
      <div class="p-3 rounded bg-[#faf5ef] border border-[#e8d9d1]"><div class="text-2xl font-semibold text-[#78494e]">${yes.length}</div><div class="text-[#594849]">respostas "Sim"</div></div>
      <div class="p-3 rounded bg-red-50 border border-red-200"><div class="text-2xl font-semibold text-red-800">${noCount}</div><div class="text-red-800">não poderão ir</div></div>
    </div>
    ${rows
      .map(
        s => `
      <div class="p-3.5 rounded border border-[#e8d9d1] bg-white">
        <div class="font-semibold text-[#453334] text-sm">
          ${escapeHtml(s.name)}
          <span class="ml-2 px-2 py-0.5 rounded text-[11px] ${
            s.attendance === 'Sim' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
          }">${s.attendance === 'Sim' ? `Vai comparecer · ${s.count} pessoa${s.count > 1 ? 's' : ''}` : 'Não poderá ir'}</span>
        </div>
        ${
          s.companions.length
            ? `<p class="text-[#453334] mt-1">👥 Acompanhantes: ${s.companions.map(escapeHtml).join(', ')}</p>`
            : ''
        }
        ${s.message ? `<p class="text-[#594849] mt-1 italic">"${escapeHtml(s.message)}"</p>` : ''}
        <span class="text-[10px] text-[#756264] block mt-1">${escapeHtml(s.createdAt)}</span>
      </div>`
      )
      .join('')}
  `;
}

function downloadRsvpCsv() {
  if (!lastRsvpRows.length) {
    alert('Carregue a lista primeiro (digite a senha e clique em "Ver lista").');
    return;
  }
  const cell = v => {
    let t = String(v == null ? '' : v);
    if (/^[=+\-@]/.test(t)) t = "'" + t;
    return '"' + t.replace(/"/g, '""') + '"';
  };
  const header = ['Data', 'Nome', 'Vai comparecer?', 'Nº de pessoas', 'Acompanhantes', 'Recado'];
  const lines = [header.map(cell).join(';')].concat(
    lastRsvpRows.map(r =>
      [r.createdAt, r.name, r.attendance, r.count, r.companions.join(', '), r.message].map(cell).join(';')
    )
  );
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'lista-de-confirmados.csv';
  a.click();
}

function saveRsvpEndpoint() {
  const val = (document.getElementById('rsvp-endpoint-input').value || '').trim();
  if (val && !/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(val)) {
    alert('O link deve ter este formato:\nhttps://script.google.com/macros/s/XXXXXXXX/exec');
    return;
  }
  if (!siteData.rsvpConfig) siteData.rsvpConfig = {};
  siteData.rsvpConfig.endpoint = val;
  saveSiteData(true);
  openRsvpAdminModal();
}

function closeRsvpAdminModal() {
  document.getElementById('rsvp-admin-modal')?.classList.add('hidden');
}

// ============================================================================
// MODO DE EDIÇÃO, CORES E SALVAMENTO PERSISTENTE
// ============================================================================
function toggleEditMode() {
  isEditMode = !isEditMode;
  document.body.classList.toggle('edit-mode', isEditMode);

  const label = document.getElementById('toggle-edit-label');
  const icon = document.getElementById('toggle-edit-icon');
  if (label) label.textContent = isEditMode ? 'Sair da Edição' : 'Editar Site';
  if (icon) icon.textContent = isEditMode ? '✅' : '✏️';

  if (!isEditMode) {
    saveSiteData(true);
  }
  renderAll();
}

function saveAndExitEditMode() {
  // Captura textos editáveis ativos antes de sair
  document.querySelectorAll('[data-editable]').forEach(el => {
    const path = el.getAttribute('data-editable');
    setNestedValue(siteData, path, el.innerText.trim());
  });
  isEditMode = false;
  document.body.classList.remove('edit-mode');
  const label = document.getElementById('toggle-edit-label');
  const icon = document.getElementById('toggle-edit-icon');
  if (label) label.textContent = 'Editar Site';
  if (icon) icon.textContent = '✏️';
  renderAll();
  saveSiteData(true);
}

async function saveSiteData(showNotification = true) {
  // 1. Salva no IndexedDB (sem limite de 5MB para fotos)
  await saveToIndexedDB(siteData);

  // 2. Salva no localStorage do navegador
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(siteData));
  } catch (e) {
    // Caso muitas fotos ultrapassem 5MB, o IndexedDB acima já salvou tudo com segurança
  }

  // 3. Se estiver rodando em servidor local, grava no disco
  if (window.location.protocol.startsWith('http')) {
    try {
      await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(siteData)
      });
    } catch (e) {}
  }

  if (showNotification) {
    const toast = document.getElementById('save-toast');
    if (toast) {
      toast.classList.remove('hidden');
      clearTimeout(window._saveToastTimer);
      window._saveToastTimer = setTimeout(() => {
        toast.classList.add('hidden');
      }, 2600);
    }
  }
}

async function resetToDefaults() {
  if (!confirm('Tem certeza que deseja restaurar todos os textos, cores e fotos para o modelo original?')) return;
  siteData = JSON.parse(JSON.stringify(window.DEFAULT_SITE_DATA));
  localStorage.removeItem(STORAGE_KEY);
  await clearIndexedDB();
  applyTheme();
  renderAll();
  initMap();
  saveSiteData(true);
}

function openThemeModal() {
  applyTheme();
  document.getElementById('theme-modal')?.classList.remove('hidden');
}

function closeThemeModal() {
  document.getElementById('theme-modal')?.classList.add('hidden');
}

function updateThemeColor(key, val) {
  if (!val || !val.startsWith('#')) return;
  siteData.theme[key] = val;
  applyTheme();
  saveSiteData(false);
}

function applyPresetPalette(rose, roseDark, roseSoft) {
  siteData.theme.rose = rose;
  siteData.theme.roseDark = roseDark;
  siteData.theme.roseSoft = roseSoft;
  applyTheme();
  saveSiteData(true);
}

// Exporta as edições para publicar no site.
// - Versão de arquivo único (site-arquivo-unico.html): baixa o HTML completo, já com as edições.
// - Versão em pasta (index.html + default-data.js): baixa o default-data.js atualizado.
function getExportData() {
  const data = JSON.parse(JSON.stringify(siteData));
  data.rsvpSubmissions = []; // respostas de teste não vão para o site publicado
  return data;
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function exportStandaloneHtml() {
  saveAndCaptureEditableTexts();
  const dataJs = `window.DEFAULT_SITE_DATA = ${JSON.stringify(getExportData(), null, 2)};\n`;

  if (ORIGINAL_PAGE_HTML) {
    const doc = new DOMParser().parseFromString(ORIGINAL_PAGE_HTML, 'text/html');
    doc.querySelectorAll('head style:not(#site-style):not(#tailwind-css)').forEach(el => el.remove());
    const dataScript = doc.getElementById('site-data');
    dataScript.textContent = '\n' + dataJs.replace(/<\/script/gi, '<\\/script') + '\n';
    const html = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
    downloadBlob(html, 'index.html', 'text/html;charset=utf-8');
    alert('Pronto! Baixamos o arquivo "index.html" com todas as edições. Publique esse arquivo no lugar do antigo.');
    return;
  }

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'default-data.js',
        types: [{ description: 'Arquivo de Dados do Site (JS)', accept: { 'application/javascript': ['.js'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(dataJs);
      await writable.close();
      alert('Arquivo default-data.js atualizado com sucesso!');
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  downloadBlob(dataJs, 'default-data.js', 'application/javascript;charset=utf-8');
}

function saveAndCaptureEditableTexts() {
  if (!isEditMode) return;
  document.querySelectorAll('[data-editable]').forEach(el => {
    setNestedValue(siteData, el.getAttribute('data-editable'), el.innerText.trim());
  });
}

window.addEventListener('DOMContentLoaded', initSite);
