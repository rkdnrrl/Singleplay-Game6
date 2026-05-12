(function () {
  'use strict';

  const FORGE_MATERIALS_KEY = 'WEB_ALP_SPACE_FISHING_FORGE_V1';
  const ALCHEMY_DRAG_UID = 'application/x-alchemy-mat-uid';
  const MAX_POT_ITEMS = 16;
  const TOUCH_SLOP = 18;

  const urlParams = new URLSearchParams(window.location.search);
  const alpToken = urlParams.get('token');
  const platformApi =
    String(urlParams.get('platformApi') || '').trim() ||
    String(window.__ALP_PLATFORM_API__ || '').trim();

  const cauldron = document.getElementById('cauldron');
  const cauldronDropZone = document.getElementById('cauldronDropZone');
  const materialListEl = document.getElementById('materialList');
  const materialScrollWrap = document.getElementById('materialScrollWrap');
  const matBadge = document.getElementById('matBadge');
  const materialHint = document.getElementById('materialHint');
  const elementStashListEl = document.getElementById('elementStashList');
  const elementStashBadge = document.getElementById('elementStashBadge');
  const elementStashHint = document.getElementById('elementStashHint');
  const cauldronChipsEl = document.getElementById('cauldronChips');
  const btnClearPot = document.getElementById('btnClearPot');
  const btnDecompose = document.getElementById('btnDecompose');
  const decomposePanel = document.getElementById('decomposePanel');
  const decomposeHint = document.getElementById('decomposeHint');
  const decomposeElements = document.getElementById('decomposeElements');
  const btnCompose = document.getElementById('btnCompose');
  const composePanel = document.getElementById('composePanel');
  const composeHint = document.getElementById('composeHint');
  const composePreview = document.getElementById('composePreview');
  const alchemyCoinAmountEl = document.getElementById('alchemyCoinAmount');

  const CLASS_BOILING = 'cauldron--boiling';
  let decomposeInFlight = false;
  let composeInFlight = false;
  /** @type {number|null|undefined} undefined=미로딩, null=실패 */
  let serverCoinsBalance = undefined;
  /** 가마솥 안 레퍼런스 (왼쪽 보관함 + 오른쪽 추출 원소) */
  let pot = [];
  /** 분해로 쌓인 원소 — 서버 `/api/alchemy/stash` 기준(로컬 보관함 키와 분리) */
  let elementStash = [];

  function renderCoinHud() {
    if (!alchemyCoinAmountEl) return;
    if (!alpToken || !platformApi) {
      serverCoinsBalance = undefined;
      alchemyCoinAmountEl.textContent = '—';
      alchemyCoinAmountEl.title = '게임월드에서 이 게임을 열면 코인이 표시됩니다.';
      return;
    }
    if (serverCoinsBalance === undefined) {
      alchemyCoinAmountEl.textContent = '…';
      alchemyCoinAmountEl.title = '불러오는 중…';
      return;
    }
    if (serverCoinsBalance === null || !Number.isFinite(serverCoinsBalance)) {
      alchemyCoinAmountEl.textContent = '—';
      alchemyCoinAmountEl.title = '코인을 불러오지 못했습니다.';
      return;
    }
    alchemyCoinAmountEl.textContent = Math.floor(serverCoinsBalance).toLocaleString();
    alchemyCoinAmountEl.title = '게임월드 보유 코인';
  }

  async function refreshServerCoins() {
    if (!alpToken || !platformApi) {
      serverCoinsBalance = undefined;
      renderCoinHud();
      return;
    }
    try {
      const r = await fetch(`${platformApi}/api/auth/me`, {
        headers: { Authorization: `Bearer ${alpToken}` },
      });
      const text = await r.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
      }
      if (r.ok && data && data.user && typeof data.user.coins === 'number') {
        serverCoinsBalance = data.user.coins;
      } else {
        serverCoinsBalance = null;
      }
    } catch {
      serverCoinsBalance = null;
    }
    renderCoinHud();
  }

  function updateDecomposeButton() {
    if (!btnDecompose) return;
    const hasLocalOnly = pot.some((m) => {
      if (!m) return true;
      if (m.kind === 'alchemy_element') return false;
      if (m.kind === 'equipment' || m.equipmentId != null) {
        return !(m.equipmentId != null && String(m.equipmentId).trim() !== '');
      }
      const sid = m.serverId != null ? String(m.serverId).trim() : '';
      if (sid && !sid.startsWith('alchemy-stash')) return false;
      return true;
    });
    const can =
      Boolean(alpToken && platformApi) &&
      pot.length > 0 &&
      !decomposeInFlight &&
      !composeInFlight &&
      !hasLocalOnly;
    btnDecompose.disabled = !can;
    if (!alpToken || !platformApi) {
      btnDecompose.title = '게임월드에서 이 게임을 열면 토큰이 붙어 분해를 호출할 수 있어요.';
    } else if (pot.length === 0) {
      btnDecompose.title = '가마솥에 재료를 넣은 뒤 누르세요.';
    } else if (hasLocalOnly) {
      btnDecompose.title = '서버에 없는 재료만 있으면 분해할 수 없습니다. 동기화된 재료·장비·추출 원소를 넣으세요.';
    } else if (composeInFlight) {
      btnDecompose.title = '조합 처리 중에는 분해할 수 없습니다.';
    } else {
      btnDecompose.title = 'AI가 재료 이름을 분석해 주기율표 원소를 제안하고, 서버에서 재료를 소모합니다.';
    }
    updateComposeButton();
  }

  function potIsElementsOnly() {
    return pot.length > 0 && pot.every((m) => m && isAlchemyElementMaterial(m));
  }

  function updateComposeButton() {
    if (!btnCompose) return;
    const can =
      Boolean(alpToken && platformApi) &&
      pot.length >= 2 &&
      potIsElementsOnly() &&
      !composeInFlight &&
      !decomposeInFlight;
    btnCompose.disabled = !can;
    if (!alpToken || !platformApi) {
      btnCompose.title = '게임월드에서 이 게임을 열면 토큰이 붙어 조합을 호출할 수 있어요.';
    } else if (pot.length < 2) {
      btnCompose.title = '추출 원소를 두 개 이상 가마솥에 넣으세요.';
    } else if (!potIsElementsOnly()) {
      btnCompose.title = '조합은 추출 원소만 섞을 수 있어요. (낚시 재료·장비는 분해에 사용)';
    } else if (composeInFlight) {
      btnCompose.title = '조합 처리 중…';
    } else if (decomposeInFlight) {
      btnCompose.title = '분해 처리 중에는 조합할 수 없습니다.';
    } else {
      btnCompose.title = '원소들을 합쳐 새로운 산출물을 만듭니다. 왼쪽 보관함에 들어갑니다.';
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
    if (!alpToken || !platformApi || pot.length === 0 || decomposeInFlight || composeInFlight) return;
    const wasBoiling = Boolean(cauldron && cauldron.classList.contains(CLASS_BOILING));
    decomposeInFlight = true;
    if (cauldron) {
      cauldron.classList.add(CLASS_BOILING);
      syncAriaBoiling();
    }
    updateDecomposeButton();
    if (composePanel) composePanel.hidden = true;
    if (decomposePanel) decomposePanel.hidden = false;
    if (decomposeHint) decomposeHint.textContent = 'AI가 재료 이름을 분석하는 중…';
    renderDecomposeElements([]);

    const slots = buildDecomposeSlotsFromPot();
    try {
      const res = await fetch(`${platformApi}/api/alchemy/decompose`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${alpToken}`,
        },
        body: JSON.stringify({ slots }),
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
      const names = slots.map((s) => s.name).filter(Boolean);
      if (decomposeHint) {
        if (elements.length === 0) {
          decomposeHint.textContent =
            '주기율표에 맞는 원소가 추출되지 않았어요. 다른 재료를 넣어 보세요.';
        } else {
          decomposeHint.textContent = `입력: ${names.length}종 이름 → 원소 ${elements.length}개. 오른쪽 추출 원소에 저장되었습니다.`;
        }
      }
      renderDecomposeElements(elements);
      if (elements.length > 0) {
        clearPot();
        await syncMaterialsFromServer();
      }
    } catch {
      if (decomposeHint) decomposeHint.textContent = '네트워크 오류로 분해에 실패했어요.';
    } finally {
      void refreshServerCoins();
      decomposeInFlight = false;
      if (cauldron) {
        cauldron.classList.toggle(CLASS_BOILING, wasBoiling);
        syncAriaBoiling();
      }
      updateDecomposeButton();
    }
  }


  function renderComposePreview(compound) {
    if (!composePreview) return;
    composePreview.innerHTML = '';
    if (!compound) return;
    const wrap = document.createElement('div');
    wrap.className = 'alchemy-compose-preview';
    const th = document.createElement('div');
    th.className = 'alchemy-compose-preview__thumb';
    const em = String(compound.itemEmoji || '⚗').trim().slice(0, 4);
    mountMaterialThumb(th, compound.pixelArt, em, 56, 56);
    const text = document.createElement('div');
    text.className = 'alchemy-compose-preview__text';
    const title = document.createElement('div');
    title.className = 'alchemy-compose-preview__title';
    title.textContent = compound.itemName != null ? String(compound.itemName) : '';
    const sub = document.createElement('div');
    sub.className = 'alchemy-compose-preview__sub';
    const coin = compound.coinValue != null ? Number(compound.coinValue) : 0;
    sub.textContent = `${compound.itemType || 'artifact'} · 판매 시 코인 ${coin}`;
    const saved = document.createElement('div');
    saved.className = 'alchemy-compose-preview__saved';
    saved.textContent = '서버에 저장됨';
    text.appendChild(title);
    text.appendChild(sub);
    text.appendChild(saved);
    wrap.appendChild(th);
    wrap.appendChild(text);
    composePreview.appendChild(wrap);
  }

  async function runCompose() {
    if (!alpToken || !platformApi || pot.length < 2 || !potIsElementsOnly() || composeInFlight || decomposeInFlight) {
      return;
    }
    composeInFlight = true;
    if (btnCompose) btnCompose.textContent = '✨ 조합 중…';
    updateDecomposeButton();
    if (decomposePanel) decomposePanel.hidden = true;
    if (composePanel) composePanel.hidden = false;
    if (composeHint) composeHint.textContent = '원소를 합성하는 중…';
    if (composePreview) composePreview.innerHTML = '';

    const slots = buildDecomposeSlotsFromPot();
    try {
      const res = await fetch(`${platformApi}/api/alchemy/compose`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${alpToken}`,
        },
        body: JSON.stringify({ slots }),
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
        if (composeHint) composeHint.textContent = msg;
        return;
      }
      const compound = data && data.compound ? data.compound : null;
      renderComposePreview(compound);
      const rationale = data && data.rationaleKo ? String(data.rationaleKo) : '';
      const form = data && data.formulaStyleKo ? String(data.formulaStyleKo) : '';
      if (composeHint) {
        const extra = form ? ` · (${form})` : '';
        composeHint.textContent = `${rationale}${extra} — 왼쪽 보관함에 저장되었습니다.`;
      }
      clearPot();
      await syncMaterialsFromServer();
    } catch {
      if (composeHint) composeHint.textContent = '네트워크 오류로 조합에 실패했어요.';
    } finally {
      composeInFlight = false;
      if (btnCompose) btnCompose.textContent = '✨ 조합';
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
      /^data:image\/(png|jpeg|webp);base64,/i.test(pa.imageDataUrl.trim()) ||
      /^data:image\/svg\+xml/i.test(pa.imageDataUrl.trim())
    );
  }

  function mountMaterialThumb(hostEl, pixelArtVal, fallbackEmoji, cssW, cssH) {
    if (!hostEl) return;
    hostEl.innerHTML = '';
    if (isForgePixelImageUrl(pixelArtVal)) {
      const im = document.createElement('img');
      im.src = pixelArtVal.imageDataUrl.trim();
      im.alt = '';
      im.className = 'forge-raster-thumb';
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

  /** 가마솥에 들어간 동일 기호 원소 칩 수 (추출 원소는 여러 칩 가능) */
  function inPotElementCountForSymbol(potArr, sym) {
    const s = String(sym || '').trim();
    if (!s) return 0;
    let n = 0;
    for (const p of potArr || []) {
      if (p && isAlchemyElementMaterial(p) && String(p.elementSymbol || '').trim() === s) n += 1;
    }
    return n;
  }

  /** 목록 행이 가마솥에 일부라도 들어갔는지 (원소는 기호 기준) */
  function materialIsInPot(m, potArr) {
    if (!m || !Array.isArray(potArr)) return false;
    if (potArr.some((p) => p && p.uid === m.uid)) return true;
    if (isAlchemyElementMaterial(m)) {
      const sym = String(m.elementSymbol || '').trim();
      return sym && inPotElementCountForSymbol(potArr, sym) > 0;
    }
    return false;
  }

  function buildDecomposeSource(m) {
    if (!m) return { kind: 'local' };
    if (isAlchemyElementMaterial(m)) {
      const sym = m.elementSymbol != null ? String(m.elementSymbol).trim() : '';
      const qty = Math.max(1, Math.floor(Number(m.stackCount)) || 1);
      return { kind: 'alchemy_element', symbol: sym, qty };
    }
    if (isEquipmentMaterial(m) && m.equipmentId != null && String(m.equipmentId).trim() !== '') {
      return { kind: 'equipment', id: String(m.equipmentId).trim() };
    }
    const sid = m.serverId != null ? String(m.serverId).trim() : '';
    if (sid && !sid.startsWith('alchemy-stash')) {
      return { kind: 'catch', id: sid };
    }
    return { kind: 'local' };
  }

  function buildDecomposeSlotsFromPot() {
    return pot.map((m) => ({
      name: String(m.name != null ? m.name : '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 120),
      source: buildDecomposeSource(m),
    }));
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
    materials = loadMaterialsFromStore().filter(
      (m) =>
        m &&
        m.kind !== 'alchemy_element' &&
        !String(m.uid || '').startsWith('alchemy-el-'),
    );
  }

  function stashPayloadToRows(stData) {
    const els = stData && Array.isArray(stData.elements) ? stData.elements : [];
    return els
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

  async function syncMaterialsFromServer() {
    if (!alpToken || !platformApi) {
      serverCoinsBalance = undefined;
      renderCoinHud();
      return;
    }
    try {
      const headers = { Authorization: `Bearer ${alpToken}` };
      const [invRes, stashRes, meRes] = await Promise.all([
        fetch(`${platformApi}/api/catches/inventory?limit=200`, { headers }),
        fetch(`${platformApi}/api/alchemy/stash`, { headers }),
        fetch(`${platformApi}/api/auth/me`, { headers }),
      ]);

      if (meRes.ok) {
        const mt = await meRes.text();
        let me = null;
        try {
          me = mt ? JSON.parse(mt) : null;
        } catch {
          me = null;
        }
        if (me && me.user && typeof me.user.coins === 'number') {
          serverCoinsBalance = me.user.coins;
        } else {
          serverCoinsBalance = null;
        }
      } else {
        serverCoinsBalance = null;
      }
      renderCoinHud();

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
        elementStash = stashPayloadToRows(stData);
      } else {
        elementStash = [];
      }

      const current = loadMaterialsFromStore();
      const localOnly = current.filter(
        (x) =>
          x &&
          (!x.serverId || String(x.serverId).trim() === '') &&
          x.kind !== 'alchemy_element' &&
          !String(x.uid || '').startsWith('alchemy-el-'),
      );
      const items = serverItems.concat(localOnly);
      localStorage.setItem(
        FORGE_MATERIALS_KEY,
        JSON.stringify({ v: 3, items, updatedAt: Date.now(), source: 'alchemy-direct' }),
      );
      refreshMaterials();
      renderMaterialList();
      renderElementStashList();
      syncPotWithMaterials();
    } catch {
      serverCoinsBalance = null;
      renderCoinHud();
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
    return (
      materials.find((m) => m && m.uid === u) || elementStash.find((m) => m && m.uid === u) || null
    );
  }

  function syncPotWithMaterials() {
    const matIds = new Set(materials.map((m) => m.uid));
    const stashIds = new Set(elementStash.map((m) => m && m.uid).filter(Boolean));
    pot = pot.filter((p) => {
      if (!p || !p.uid) return false;
      if (matIds.has(p.uid)) return true;
      if (stashIds.has(p.uid)) return true;
      if (isAlchemyElementMaterial(p) && p.stashRowUid && stashIds.has(p.stashRowUid)) return true;
      return false;
    });
    renderCauldronChips();
    renderMaterialList();
    renderElementStashList();
  }

  function addToPotByUid(uid) {
    const m = findMaterialByUid(uid);
    if (!m) return;
    if (pot.length >= MAX_POT_ITEMS) return;

    if (isAlchemyElementMaterial(m)) {
      const totalStack = m.stackCount != null ? Math.max(1, Math.floor(Number(m.stackCount))) : 1;
      const sym = String(m.elementSymbol || '').trim();
      if (!sym) return;
      const inPotSym = inPotElementCountForSymbol(pot, sym);
      if (inPotSym >= totalStack) return;
      const clone = {
        ...m,
        uid: `alchemy-pot-${sym}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
        stackCount: 1,
        stashRowUid: m.uid,
      };
      pot.push(clone);
    } else {
      if (pot.some((p) => p.uid === m.uid)) return;
      pot.push(m);
    }
    renderCauldronChips();
    renderMaterialList();
    renderElementStashList();
  }

  function removeFromPot(uid) {
    const u = String(uid || '').trim();
    pot = pot.filter((p) => p.uid !== u);
    renderCauldronChips();
    renderMaterialList();
    renderElementStashList();
  }

  function clearPot() {
    pot = [];
    renderCauldronChips();
    renderMaterialList();
    renderElementStashList();
  }

  function createMaterialRow(m, potArr) {
    const inPot = materialIsInPot(m, potArr);
    const row = document.createElement('div');
    row.className = `alchemy-mat rarity-${rarityClass(m.rarity)}${isEquipmentMaterial(m) ? ' inv-item--equipment' : ''}${isAlchemyElementMaterial(m) ? ' alchemy-mat--element' : ''}${inPot ? ' alchemy-mat--in-pot' : ''}`;
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

    if (isAlchemyElementMaterial(m)) {
      const totalStack =
        m.stackCount != null ? Math.max(1, Math.floor(Number(m.stackCount))) : 1;
      const sym = String(m.elementSymbol || '').trim();
      const inPotForSym = inPotElementCountForSymbol(potArr, sym);
      const displayStack = Math.max(0, totalStack - inPotForSym);
      const stackEl = document.createElement('span');
      stackEl.className = 'alchemy-mat__stack';
      if (displayStack === 0 && inPotForSym > 0) {
        stackEl.classList.add('alchemy-mat__stack--in-pot-all');
      }
      stackEl.textContent = `×${displayStack}`;
      stackEl.title =
        inPotForSym > 0
          ? `보유 ${totalStack} · 가마솥에 ${inPotForSym} · 남은 수량 ${displayStack}`
          : `보유 ${totalStack}`;
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

    return row;
  }

  function renderMaterialList() {
    if (!materialListEl) return;
    if (matBadge) matBadge.textContent = String(materials.length);

    if (materials.length === 0) {
      materialListEl.innerHTML =
        '<p class="alchemy-dock__hint" style="margin:0.5rem 0;text-align:center">비어 있어요. 우주 낚시·대장간에서 모은 재료, 장비, 영혼 계열이 여기 동기화됩니다.</p>';
      if (materialHint) {
        materialHint.textContent =
          alpToken && platformApi
            ? '서버와 동기화됨 · 가마솥으로 끌어 넣을 수 있어요.'
            : '?token= 없으면 이 PC에 저장된 로컬 보관함만 보입니다.';
      }
      updateDecomposeButton();
      return;
    }

    if (materialHint) {
      materialHint.textContent =
        '재료·장비·영혼 계열 — 가마솥으로 끌어 넣으세요. (칩 클릭으로 빼기)';
    }

    materialListEl.innerHTML = '';
    materials.forEach((m) => {
      materialListEl.appendChild(createMaterialRow(m, pot));
    });
    updateDecomposeButton();
  }

  function elementStashRemainingQtySum() {
    let sum = 0;
    elementStash.forEach((m) => {
      if (!isAlchemyElementMaterial(m)) return;
      const totalStack =
        m.stackCount != null ? Math.max(1, Math.floor(Number(m.stackCount))) : 1;
      const sym = String(m.elementSymbol || '').trim();
      const inPotForSym = inPotElementCountForSymbol(pot, sym);
      sum += Math.max(0, totalStack - inPotForSym);
    });
    return sum;
  }

  function renderElementStashList() {
    if (!elementStashListEl) return;
    if (elementStashBadge) elementStashBadge.textContent = String(elementStashRemainingQtySum());

    if (elementStash.length === 0) {
      elementStashListEl.innerHTML =
        '<p class="alchemy-element-dock__hint" style="margin:0.5rem 0;text-align:center">아직 없어요. 가마솥에 재료를 넣고 분해하면 주기율표 원소가 쌓입니다.</p>';
      if (elementStashHint) {
        elementStashHint.textContent =
          alpToken && platformApi
            ? '서버 연동 · 조합(예정)에 쓸 추출물입니다.'
            : '게임월드에서 열면 서버에 저장·동기화됩니다.';
      }
      updateDecomposeButton();
      return;
    }

    if (elementStashHint) {
      elementStashHint.textContent = '가마솥에 다시 넣어 재분해·조합(예정)에 활용할 수 있어요.';
    }

    elementStashListEl.innerHTML = '';
    elementStash.forEach((m) => {
      elementStashListEl.appendChild(createMaterialRow(m, pot));
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

  if (btnCompose) {
    btnCompose.addEventListener('click', () => void runCompose());
  }

  window.addEventListener('storage', (ev) => {
    if (ev.key !== FORGE_MATERIALS_KEY) return;
    refreshMaterials();
    syncPotWithMaterials();
  });

  wireCauldronDropZone();
  refreshMaterials();
  renderMaterialList();
  renderElementStashList();
  renderCauldronChips();
  syncAriaBoiling();
  updateDecomposeButton();

  renderCoinHud();
  void syncMaterialsFromServer();
})();
