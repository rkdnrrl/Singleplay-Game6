(function () {
  'use strict';

  const FORGE_MATERIALS_KEY = 'WEB_ALP_SPACE_FISHING_FORGE_V1';
  const ALCHEMY_DRAG_UID = 'application/x-alchemy-mat-uid';
  const MAX_POT_ITEMS = 16;
  const TOUCH_SLOP = 18;

  const urlParams = new URLSearchParams(window.location.search);
  const alpToken = urlParams.get('token');
  const platformApi = window.__ALP_PLATFORM_API__ || '';

  const cauldron = document.getElementById('cauldron');
  const cauldronDropZone = document.getElementById('cauldronDropZone');
  const materialListEl = document.getElementById('materialList');
  const materialScrollWrap = document.getElementById('materialScrollWrap');
  const matBadge = document.getElementById('matBadge');
  const materialHint = document.getElementById('materialHint');
  const cauldronChipsEl = document.getElementById('cauldronChips');
  const btnClearPot = document.getElementById('btnClearPot');
  const btnDecompose = document.getElementById('btnDecompose');
  const decomposePanel = document.getElementById('decomposePanel');
  const decomposeHint = document.getElementById('decomposeHint');
  const decomposeElements = document.getElementById('decomposeElements');

  const CLASS_BOILING = 'cauldron--boiling';
  let decomposeInFlight = false;
  /** 가마솥 안 레퍼런스 (원본은 materials 배열과 동기) */
  let pot = [];

  function updateDecomposeButton() {
    if (!btnDecompose) return;
    const can =
      Boolean(alpToken && platformApi) && pot.length > 0 && !decomposeInFlight;
    btnDecompose.disabled = !can;
    if (!alpToken || !platformApi) {
      btnDecompose.title = '게임월드에서 이 게임을 열면 토큰이 붙어 분해를 호출할 수 있어요.';
    } else if (pot.length === 0) {
      btnDecompose.title = '가마솥에 재료를 넣은 뒤 누르세요.';
    } else {
      btnDecompose.title = 'AI가 재료 이름을 분석해 주기율표 원소를 제안합니다.';
    }
  }

  function renderDecomposeElements(elements) {
    if (!decomposeElements) return;
    decomposeElements.innerHTML = '';
    if (!elements || elements.length === 0) return;
    elements.forEach((el) => {
      const tile = document.createElement('div');
      tile.className = 'alchemy-el-tile';
      const sym = document.createElement('span');
      sym.className = 'alchemy-el-tile__sym';
      sym.textContent = el.symbol != null ? String(el.symbol) : '';
      tile.appendChild(sym);
      if (el.atomicNumber != null) {
        const z = document.createElement('span');
        z.className = 'alchemy-el-tile__z';
        z.textContent = String(el.atomicNumber);
        tile.appendChild(z);
      }
      if (el.nameKo) {
        const ko = document.createElement('span');
        ko.className = 'alchemy-el-tile__ko';
        ko.textContent = String(el.nameKo);
        tile.appendChild(ko);
      }
      if (el.rationaleKo) {
        const w = document.createElement('span');
        w.className = 'alchemy-el-tile__why';
        w.textContent = String(el.rationaleKo);
        tile.appendChild(w);
      }
      decomposeElements.appendChild(tile);
    });
  }

  async function runDecompose() {
    if (!alpToken || !platformApi || pot.length === 0 || decomposeInFlight) return;
    decomposeInFlight = true;
    updateDecomposeButton();
    if (decomposePanel) decomposePanel.hidden = false;
    if (decomposeHint) decomposeHint.textContent = 'AI가 재료 이름을 분석하는 중…';
    renderDecomposeElements([]);

    const names = pot.map((m) => String(m.name != null ? m.name : '').trim()).filter(Boolean);
    try {
      const res = await fetch(`${platformApi}/api/alchemy/decompose`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${alpToken}`,
        },
        body: JSON.stringify({ names }),
      });
      const text = await res.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
      }
      if (!res.ok) {
        const msg = data && data.error && data.error.message ? String(data.error.message) : `요청 실패 (${res.status})`;
        if (decomposeHint) decomposeHint.textContent = msg;
        return;
      }
      const elements = data && Array.isArray(data.elements) ? data.elements : [];
      if (decomposeHint) {
        if (elements.length === 0) {
          decomposeHint.textContent =
            '주기율표에 맞는 원소가 추출되지 않았어요. 다른 재료를 넣어 보세요.';
        } else {
          decomposeHint.textContent = `입력: ${names.length}종 이름 → 원소 ${elements.length}개. 왼쪽 연금술 보관함에 저장되었습니다.`;
        }
      }
      renderDecomposeElements(elements);
      if (elements.length > 0) await syncMaterialsFromServer();
    } catch {
      if (decomposeHint) decomposeHint.textContent = '네트워크 오류로 분해에 실패했어요.';
    } finally {
      decomposeInFlight = false;
      updateDecomposeButton();
    }
  }


  const MAT_EMOJI_POOL = [
    '🐟', '🐠', '🐡', '🪸', '🦑', '🪼', '🐙', '✨', '🌌', '💎', '🔮', '🛸',
    '🪨', '⚙️', '🧩', '☄️', '🌠', '💫', '🔱', '🫧', '🌀', '🦈', '🐬',
  ];

  function matEmoji(name) {
    let h = 2166136261;
    const s = String(name);
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return MAT_EMOJI_POOL[Math.abs(h >>> 0) % MAT_EMOJI_POOL.length];
  }

  const PIXEL_MAT = '#08081a';
  function pixelPaintColor(hex, cidx) {
    if (cidx === 0) return PIXEL_MAT;
    if (!hex || typeof hex !== 'string') return PIXEL_MAT;
    const h = hex.trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(h)) return PIXEL_MAT;
    const r = parseInt(h.slice(1, 3), 16) / 255;
    const g = parseInt(h.slice(3, 5), 16) / 255;
    const b = parseInt(h.slice(5, 7), 16) / 255;
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const cap = cidx === 0 ? 0.4 : cidx >= 5 ? 0.82 : 0.58;
    if (L <= cap) return h.toLowerCase();
    const f = cap / L;
    const rr = Math.min(255, Math.round(r * f * 255));
    const gg = Math.min(255, Math.round(g * f * 255));
    const bb = Math.min(255, Math.round(b * f * 255));
    return `#${rr.toString(16).padStart(2, '0')}${gg.toString(16).padStart(2, '0')}${bb.toString(16).padStart(2, '0')}`;
  }

  function sanitizeForgePixelArt(pa) {
    if (!pa || !Array.isArray(pa.cells) || pa.cells.length < 4) return null;
    const palIn = Array.isArray(pa.palette) ? pa.palette : [];
    const palette = [PIXEL_MAT];
    for (let i = 0; i < palIn.length && palette.length < 48; i += 1) {
      const hx = String(palIn[i] || '').trim();
      if (/^#[0-9a-fA-F]{6}$/.test(hx)) palette.push(hx.toLowerCase());
    }
    if (palette.length < 2) return null;
    let w = Number(pa.w) | 0;
    let h = Number(pa.h) | 0;
    const clen = pa.cells.length;
    const cells = pa.cells.map((c) => Number(c) | 0);
    if (w > 0 && h > 0 && w * h === clen) {
      return { w, h, palette, cells, fromEmoji: !!pa.fromEmoji };
    }
    const side = Math.round(Math.sqrt(clen));
    if (side >= 4 && side * side === clen) {
      return { w: side, h: side, palette, cells, fromEmoji: !!pa.fromEmoji };
    }
    return null;
  }

  function mountForgePixelArt(hostEl, art, cssW, cssH) {
    if (!hostEl || !art || !Array.isArray(art.cells) || !Array.isArray(art.palette)) return;
    const canvas = document.createElement('canvas');
    canvas.width = art.w;
    canvas.height = art.h;
    canvas.className = 'pixel-art-canvas';
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = PIXEL_MAT;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < art.cells.length; i += 1) {
      const cidx = art.cells[i];
      const px = i % art.w;
      const py = Math.floor(i / art.w);
      const raw = cidx === 0 ? PIXEL_MAT : (art.palette[cidx] || PIXEL_MAT);
      ctx.fillStyle = art.fromEmoji ? raw.toLowerCase() : pixelPaintColor(raw, cidx);
      ctx.fillRect(px, py, 1, 1);
    }
    const scale = 2;
    canvas.style.width = `${cssW != null ? cssW : art.w * scale}px`;
    canvas.style.height = `${cssH != null ? cssH : art.h * scale}px`;
    canvas.style.imageRendering = 'pixelated';
    hostEl.innerHTML = '';
    hostEl.appendChild(canvas);
  }

  function isForgePixelImageUrl(pa) {
    return (
      pa &&
      typeof pa === 'object' &&
      typeof pa.imageDataUrl === 'string' &&
      /^data:image\/(png|jpeg|webp);base64,/i.test(pa.imageDataUrl.trim())
    );
  }

  function mountMaterialThumb(hostEl, pixelArtVal, fallbackEmoji, cssW, cssH) {
    if (!hostEl) return;
    hostEl.innerHTML = '';
    if (isForgePixelImageUrl(pixelArtVal)) {
      const im = document.createElement('img');
      im.src = pixelArtVal.imageDataUrl.trim();
      im.alt = '';
      im.decoding = 'async';
      im.loading = 'lazy';
      im.draggable = false;
      im.width = cssW || 40;
      im.height = cssH || 40;
      hostEl.appendChild(im);
      return;
    }
    const art = sanitizeForgePixelArt(pixelArtVal);
    if (art) {
      mountForgePixelArt(hostEl, art, cssW, cssH);
      return;
    }
    const span = document.createElement('span');
    span.className = 'alchemy-mat__emoji';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = fallbackEmoji || '✨';
    hostEl.appendChild(span);
  }

  function isEquipmentMaterial(m) {
    return Boolean(m && (m.kind === 'equipment' || m.equipmentId != null));
  }

  function isAlchemyElementMaterial(m) {
    return Boolean(m && m.kind === 'alchemy_element');
  }

  function loadMaterialsFromStore() {
    try {
      const raw = localStorage.getItem(FORGE_MATERIALS_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      const items = Array.isArray(data.items) ? data.items : [];
      return items.filter((i) => i && i.uid);
    } catch {
      return [];
    }
  }

  let materials = [];

  function refreshMaterials() {
    materials = loadMaterialsFromStore();
  }

  async function syncMaterialsFromServer() {
    if (!alpToken || !platformApi) return;
    try {
      const headers = { Authorization: `Bearer ${alpToken}` };
      const [invRes, stashRes] = await Promise.all([
        fetch(`${platformApi}/api/catches/inventory?limit=200`, { headers }),
        fetch(`${platformApi}/api/alchemy/stash`, { headers }),
      ]);
      if (!invRes.ok) return;
      const invText = await invRes.text();
      let invData = null;
      if (invText) {
        try {
          invData = JSON.parse(invText);
        } catch {
          invData = null;
        }
      }
      const catches = invData && Array.isArray(invData.catches) ? invData.catches : [];
      const serverItems = catches
        .filter((c) => c && c.id != null && String(c.id).trim() !== '')
        .map((c) => ({
          uid: `srv-${String(c.id).trim()}`,
          name: c.itemName != null ? String(c.itemName) : '재료',
          rarity: c.rarity != null ? String(c.rarity).toLowerCase() : 'common',
          itemType: c.itemType != null ? String(c.itemType).toLowerCase().trim() : '',
          size: c.size != null ? c.size : null,
          coins: c.coinValue != null ? c.coinValue : 0,
          serverId: String(c.id).trim(),
          pixelArt: c.pixelArt || null,
        }));

      let stashItems = [];
      if (stashRes.ok) {
        const stText = await stashRes.text();
        let stData = null;
        if (stText) {
          try {
            stData = JSON.parse(stText);
          } catch {
            stData = null;
          }
        }
        const els = stData && Array.isArray(stData.elements) ? stData.elements : [];
        stashItems = els
          .filter((e) => e && e.symbol && Number(e.count) > 0)
          .map((e) => {
            const sym = String(e.symbol).trim();
            const nameKo = e.nameKo != null ? String(e.nameKo).trim() : '';
            const display = nameKo ? `${nameKo} (${sym})` : sym;
            const cnt = Math.max(1, Math.floor(Number(e.count)) || 1);
            return {
              uid: `alchemy-el-${sym}`,
              kind: 'alchemy_element',
              name: display,
              rarity: 'common',
              serverId: `alchemy-stash:${sym}`,
              stackCount: cnt,
              elementSymbol: sym,
              atomicNumber: e.atomicNumber != null ? Number(e.atomicNumber) : null,
              pixelArt: null,
            };
          });
      }

      const current = loadMaterialsFromStore();
      const localOnly = current.filter(
        (x) =>
          x &&
          (!x.serverId || String(x.serverId).trim() === '') &&
          x.kind !== 'alchemy_element' &&
          !String(x.uid || '').startsWith('alchemy-el-'),
      );
      const items = serverItems.concat(stashItems).concat(localOnly);
      localStorage.setItem(
        FORGE_MATERIALS_KEY,
        JSON.stringify({ v: 3, items, updatedAt: Date.now(), source: 'alchemy-direct' }),
      );
      refreshMaterials();
      renderMaterialList();
      syncPotWithMaterials();
    } catch {
      /* ignore */
    }
  }

  function rarityClass(r) {
    const x = String(r || 'common').toLowerCase();
    if (x === 'rare' || x === 'epic' || x === 'legendary' || x === 'common') return x;
    return 'common';
  }

  function findMaterialByUid(uid) {
    const u = String(uid || '').trim();
    if (!u) return null;
    return materials.find((m) => m && m.uid === u) || null;
  }

  function syncPotWithMaterials() {
    const valid = new Set(materials.map((m) => m.uid));
    pot = pot.filter((m) => m && valid.has(m.uid));
    renderCauldronChips();
    renderMaterialList();
  }

  function addToPotByUid(uid) {
    const m = findMaterialByUid(uid);
    if (!m) return;
    if (pot.some((p) => p.uid === m.uid)) return;
    if (pot.length >= MAX_POT_ITEMS) return;
    pot.push(m);
    renderCauldronChips();
    renderMaterialList();
  }

  function removeFromPot(uid) {
    const u = String(uid || '').trim();
    pot = pot.filter((p) => p.uid !== u);
    renderCauldronChips();
    renderMaterialList();
  }

  function clearPot() {
    pot = [];
    renderCauldronChips();
    renderMaterialList();
  }

  function renderMaterialList() {
    if (!materialListEl) return;
    const inPot = new Set(pot.map((p) => p.uid));
    if (matBadge) matBadge.textContent = String(materials.length);

    if (materials.length === 0) {
      materialListEl.innerHTML =
        '<p class="alchemy-dock__hint" style="margin:0.5rem 0;text-align:center">보관함이 비어 있어요. 우주 낚시에서 잡은 뒤 동기화하거나, 토큰이 있으면 분해로 얻은 원소도 여기에 쌓입니다.</p>';
      if (materialHint) {
        materialHint.textContent =
          alpToken && platformApi
            ? '서버 동기화됨 · 낚시 재료와 분해로 쌓인 원소가 함께 표시됩니다.'
            : '?token= 없으면 로컬 보관함만 표시됩니다.';
      }
      updateDecomposeButton();
      return;
    }

    if (materialHint) {
      materialHint.textContent = '끌어서 가마솥에 넣으세요. (낚시 재료·분해 원소 · 칩 클릭으로 빼기)';
    }

    materialListEl.innerHTML = '';
    materials.forEach((m) => {
      const row = document.createElement('div');
      row.className = `alchemy-mat rarity-${rarityClass(m.rarity)}${isEquipmentMaterial(m) ? ' inv-item--equipment' : ''}${isAlchemyElementMaterial(m) ? ' alchemy-mat--element' : ''}${inPot.has(m.uid) ? ' alchemy-mat--in-pot' : ''}`;
      row.dataset.uid = m.uid;
      row.draggable = true;

      const thumb = document.createElement('div');
      thumb.className = 'alchemy-mat__thumb';
      mountMaterialThumb(
        thumb,
        m.pixelArt,
        isAlchemyElementMaterial(m) ? '🧪' : matEmoji(m.name),
        40,
        40,
      );
      row.appendChild(thumb);

      const nameEl = document.createElement('span');
      nameEl.className = 'alchemy-mat__name';
      nameEl.textContent = m.name != null ? String(m.name) : '';
      row.appendChild(nameEl);

      const stackN = isAlchemyElementMaterial(m) && m.stackCount != null ? Math.floor(Number(m.stackCount)) : 0;
      if (isAlchemyElementMaterial(m) && stackN >= 1) {
        const stackEl = document.createElement('span');
        stackEl.className = 'alchemy-mat__stack';
        stackEl.textContent = `×${stackN}`;
        stackEl.title = `보유 ${stackN}`;
        row.appendChild(stackEl);
      }

      row.addEventListener('dragstart', (e) => {
        if (!e.dataTransfer) return;
        e.dataTransfer.setData(ALCHEMY_DRAG_UID, m.uid);
        e.dataTransfer.setData('text/plain', m.uid);
        e.dataTransfer.effectAllowed = 'copyMove';
        row.classList.add('alchemy-mat--dragging');
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('alchemy-mat--dragging');
        clearDropHover();
      });

      const touchState = { active: false, x0: 0, y0: 0, moved: false };
      row.addEventListener(
        'touchstart',
        (e) => {
          if (e.touches.length !== 1) return;
          const t = e.touches[0];
          touchState.active = true;
          touchState.x0 = t.clientX;
          touchState.y0 = t.clientY;
          touchState.moved = false;
        },
        { passive: true },
      );
      row.addEventListener(
        'touchmove',
        (e) => {
          if (!touchState.active || e.touches.length !== 1) return;
          const t = e.touches[0];
          if (Math.hypot(t.clientX - touchState.x0, t.clientY - touchState.y0) > TOUCH_SLOP) touchState.moved = true;
        },
        { passive: true },
      );
      row.addEventListener('touchend', (e) => {
        if (!touchState.active) return;
        touchState.active = false;
        const t = e.changedTouches[0];
        if (!t) return;
        if (touchState.moved) {
          const el = document.elementFromPoint(t.clientX, t.clientY);
          if (el && cauldronDropZone && cauldronDropZone.contains(el)) addToPotByUid(m.uid);
        }
        touchState.moved = false;
      });

      materialListEl.appendChild(row);
    });
    updateDecomposeButton();
  }

  function renderCauldronChips() {
    if (!cauldronChipsEl) return;
    cauldronChipsEl.innerHTML = '';
    if (pot.length === 0) return;
    pot.forEach((m) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'cauldron-chip';
      chip.title = '클릭하여 가마솥에서 빼기';
      const label = String(m.name || '').trim();
      const short = label.length > 14 ? `${label.slice(0, 12)}…` : label;
      chip.innerHTML = `<span class="cauldron-chip__label">${escapeHtml(short)}</span><span class="cauldron-chip__x" aria-hidden="true">×</span>`;
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        removeFromPot(m.uid);
      });
      cauldronChipsEl.appendChild(chip);
    });
    updateDecomposeButton();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function materialDragPayloadPresent(dt) {
    if (!dt || !dt.types) return false;
    return Array.from(dt.types).includes(ALCHEMY_DRAG_UID) || Array.from(dt.types).includes('text/plain');
  }

  function readDragUid(dt) {
    if (!dt) return '';
    try {
      const a = dt.getData(ALCHEMY_DRAG_UID);
      if (a) return String(a).trim();
      const b = dt.getData('text/plain');
      return b ? String(b).trim() : '';
    } catch {
      return '';
    }
  }

  function clearDropHover() {
    if (cauldronDropZone) cauldronDropZone.classList.remove('cauldron-wrap--drop-hover');
  }

  let dropZoneWired = false;
  function wireCauldronDropZone() {
    if (dropZoneWired || !cauldronDropZone) return;
    dropZoneWired = true;
    const zone = cauldronDropZone;
    zone.addEventListener('dragenter', (e) => {
      if (!materialDragPayloadPresent(e.dataTransfer)) return;
      e.preventDefault();
      zone.classList.add('cauldron-wrap--drop-hover');
    });
    zone.addEventListener('dragover', (e) => {
      if (!materialDragPayloadPresent(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      zone.classList.add('cauldron-wrap--drop-hover');
    });
    zone.addEventListener('dragleave', (e) => {
      const rt = e.relatedTarget;
      if (rt == null || !zone.contains(rt)) zone.classList.remove('cauldron-wrap--drop-hover');
    });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      clearDropHover();
      const uid = readDragUid(e.dataTransfer);
      if (uid) addToPotByUid(uid);
    });
    document.addEventListener('dragend', clearDropHover, true);
  }

  function syncAriaBoiling() {
    if (!cauldron) return;
    cauldron.setAttribute('aria-pressed', cauldron.classList.contains(CLASS_BOILING) ? 'true' : 'false');
  }

  function toggleBoiling() {
    if (!cauldron) return;
    cauldron.classList.toggle(CLASS_BOILING);
    syncAriaBoiling();
  }

  if (cauldron) {
    cauldron.addEventListener('click', (e) => {
      if (e.target.closest('.cauldron-chip')) return;
      toggleBoiling();
    });
  }

  if (btnClearPot) {
    btnClearPot.addEventListener('click', () => clearPot());
  }

  if (btnDecompose) {
    btnDecompose.addEventListener('click', () => void runDecompose());
  }

  window.addEventListener('storage', (ev) => {
    if (ev.key !== FORGE_MATERIALS_KEY) return;
    refreshMaterials();
    syncPotWithMaterials();
  });

  wireCauldronDropZone();
  refreshMaterials();
  renderMaterialList();
  renderCauldronChips();
  syncAriaBoiling();
  updateDecomposeButton();

  void syncMaterialsFromServer();
})();
