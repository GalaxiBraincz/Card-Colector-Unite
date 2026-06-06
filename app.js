'use strict';

let currentUser = null;
let selectedPackAmount = 1;
let tickInterval = null;
let pendingCards = [];
let multiRevealed = [];
let duelState = null;
let duelMode = 'bot';
let luckyNextPack = false;

function getSession() {
  return DB.getSession();
}

function getGlobalCards() {
  return DB.getGlobalCache().globalCards || [];
}

function getGlobalVersion() {
  return DB.getGlobalCache().updateVersion || 0;
}

function getAllCards() {
  const cards = [...BASE_CARDS, ...getGlobalCards()];
  const drafts = (currentUser?.customCards || []).filter((c) => c.draft);
  const existingIds = new Set(cards.map((c) => c.id));
  drafts.forEach((c) => {
    if (!existingIds.has(c.id)) cards.push(c);
  });
  return cards;
}

function getOwnerDrafts() {
  return (currentUser?.customCards || []).filter((c) => c.draft);
}

function getCardById(id) {
  return getAllCards().find((c) => c.id === id);
}

function getCardLevel(id) {
  return currentUser?.owned[id] || 0;
}

function getTotalCps() {
  let total = 0;
  const boost = currentUser?.cpsBoost || 0;
  for (const [id, level] of Object.entries(currentUser?.owned || {})) {
    const card = getCardById(id);
    if (card) total += getCardCps(card, level);
  }
  return total + (Object.keys(currentUser?.owned || {}).length > 0 ? boost : 0);
}

function formatNumber(n) {
  const val = Math.floor(n * 10) / 10;
  if (val >= 1_000_000) return (val / 1_000_000).toFixed(1) + 'M';
  if (val >= 10_000) return (val / 1_000).toFixed(1) + 'K';
  return Number.isInteger(val) ? val.toLocaleString('cs-CZ') : val.toFixed(1);
}

function persistUser() {
  if (currentUser) DB.persistUser(currentUser);
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.toggle('hidden', !msg);
}

async function login(username, password) {
  try {
    currentUser = await DB.login(username, password);
    currentUser.username = currentUser.username || username.trim();
    showAuthError('');
    enterApp();
  } catch (e) {
    showAuthError(e.message || 'Přihlášení selhalo.');
  }
}

async function register(username, password) {
  try {
    currentUser = await DB.register(username, password);
    currentUser.username = currentUser.username || username.trim();
    showAuthError('');
    enterApp();
  } catch (e) {
    showAuthError(e.message || 'Registrace selhala.');
  }
}

async function logout() {
  persistUser();
  await DB.logout();
  currentUser = null;
  if (tickInterval) clearInterval(tickInterval);
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
}

function enterApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  const username = currentUser.username || getSession();
  const badge = document.getElementById('user-badge');
  badge.textContent = currentUser.rank === 'owner' ? '👑 ' + username : username;
  badge.className = 'user-badge' + (currentUser.rank === 'owner' ? ' owner' : '');

  const onlineBadge = document.getElementById('online-badge');
  if (onlineBadge) {
    onlineBadge.classList.toggle('hidden', !DB.isOnline());
    onlineBadge.textContent = DB.isOnline() ? '☁️ Online' : '';
    onlineBadge.title = DB.isOnline() ? 'Připojeno k Firebase — data se synchronizují' : '';
  }

  document.querySelector('.nav-owner').classList.toggle('hidden', currentUser.rank !== 'owner');
  applyTheme(currentUser.activeTheme || 'default');
  renderPackAmountBtns();
  renderPacksShop();
  renderShop();
  updateStats();
  renderCollection();
  renderFriends();
  renderOwnerPanel();
  startTick();
  applyDeviceMode();
  checkForGameUpdate();
}

function checkForGameUpdate() {
  const banner = document.getElementById('update-banner');
  const textEl = document.getElementById('update-banner-text');
  if (!banner || !textEl) return;
  const lastSeen = currentUser.lastSeenUpdate || 0;
  const ver = getGlobalVersion();
  if (ver > lastSeen && getGlobalCards().length > 0) {
    textEl.textContent = '🎉 Nová aktualizace v' + ver + '! Přibyly nové karty — najdeš je v balíčcích a sbírce.';
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

function dismissUpdateBanner() {
  currentUser.lastSeenUpdate = getGlobalVersion();
  persistUser();
  document.getElementById('update-banner')?.classList.add('hidden');
}

/* ═══════════════════════════════════════════
   SHOP & THEMES
   ═══════════════════════════════════════════ */

function ensureShopData() {
  if (!currentUser.shopOwned) currentUser.shopOwned = { themes: ['default'] };
  if (!currentUser.shopOwned.themes.includes('default')) {
    currentUser.shopOwned.themes.unshift('default');
  }
  if (!currentUser.activeTheme) currentUser.activeTheme = 'default';
}

function ownsShopItem(itemId) {
  if (itemId === 'lucky_pack' || itemId === 'boost_cps') return false;
  ensureShopData();
  if (itemId.startsWith('theme_')) {
    const themeId = SHOP_ITEMS.find((i) => i.id === itemId)?.themeId;
    return themeId && currentUser.shopOwned.themes.includes(themeId);
  }
  return (currentUser.shopPurchased || []).includes(itemId);
}

function applyTheme(themeId, skipSave) {
  ensureShopData();
  if (!SHOP_THEMES[themeId]) themeId = 'default';
  document.body.classList.remove(...Object.keys(SHOP_THEMES).map((t) => 'theme-' + t));
  document.body.classList.add('theme-' + themeId);

  const theme = SHOP_THEMES[themeId];
  const root = document.documentElement;
  Object.keys(SHOP_THEMES.default.vars).forEach((k) => root.style.removeProperty(k));
  Object.entries(theme.vars || {}).forEach(([k, v]) => root.style.setProperty(k, v));

  if (currentUser && !skipSave) {
    currentUser.activeTheme = themeId;
    persistUser();
  }
}

function renderShop() {
  if (!currentUser) return;
  ensureShopData();
  const grid = document.getElementById('shop-grid');
  if (!grid) return;

  grid.innerHTML = SHOP_ITEMS.map((item) => {
    const owned = ownsShopItem(item.id);
    const canBuy = !owned && currentUser.coins >= item.cost;
    return `<div class="shop-item shop-item--${item.type}${owned ? ' owned' : ''}">
      <span class="shop-item-emoji">${item.emoji}</span>
      <h3 class="shop-item-name">${item.name}</h3>
      <p class="shop-item-desc">${item.desc}</p>
      ${owned
        ? '<span class="shop-owned-badge">✅ Vlastníš</span>'
        : `<button class="btn-primary shop-buy-btn" data-item-id="${item.id}" ${canBuy ? '' : 'disabled'}>
            Koupit <span class="btn-price">${item.cost} 🪙</span>
          </button>`
      }
    </div>`;
  }).join('');

  grid.querySelectorAll('.shop-buy-btn').forEach((btn) => {
    btn.addEventListener('click', () => buyShopItem(btn.dataset.itemId));
  });

  const ownedEl = document.getElementById('owned-themes');
  if (ownedEl) {
    ownedEl.innerHTML = currentUser.shopOwned.themes.map((tid) => {
      const t = SHOP_THEMES[tid];
      if (!t) return '';
      const active = currentUser.activeTheme === tid;
      return `<button class="theme-btn${active ? ' active' : ''}" data-theme="${tid}">
        ${t.emoji} ${t.name}${active ? ' ✓' : ''}
      </button>`;
    }).join('');
    ownedEl.querySelectorAll('.theme-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyTheme(btn.dataset.theme);
        renderShop();
      });
    });
  }
}

function buyShopItem(itemId) {
  const item = SHOP_ITEMS.find((i) => i.id === itemId);
  if (!item || ownsShopItem(itemId)) return;
  if (currentUser.coins < item.cost) return;

  currentUser.coins -= item.cost;
  ensureShopData();

  if (item.type === 'theme') {
    if (!currentUser.shopOwned.themes.includes(item.themeId)) {
      currentUser.shopOwned.themes.push(item.themeId);
    }
    applyTheme(item.themeId);
  } else if (item.type === 'boost') {
    currentUser.cpsBoost = (currentUser.cpsBoost || 0) + (item.boostCps || 1);
  } else if (item.type === 'item' && itemId === 'lucky_pack') {
    luckyNextPack = true;
  } else {
    currentUser.shopPurchased = currentUser.shopPurchased || [];
    currentUser.shopPurchased.push(itemId);
  }

  persistUser();
  updateStats();
  renderShop();
  alert('Zakoupeno: ' + item.name + '!');
}


/* ═══════════════════════════════════════════
   DEVICE MODE (PC / Phone)
   ═══════════════════════════════════════════ */

function detectPhoneMode() {
  const ua = navigator.userAgent || '';
  const mobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);
  const narrow = window.matchMedia('(max-width: 768px)').matches;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const wide = window.matchMedia('(min-width: 1024px)').matches;

  if (narrow) return true;
  if (wide && !mobileUA) return false;
  if (mobileUA && window.innerWidth < 1024) return true;
  if (coarse && !wide) return true;
  return false;
}

function applyDeviceMode() {
  const isPhone = detectPhoneMode();
  document.body.classList.toggle('mode-phone', isPhone);
  document.body.classList.toggle('mode-pc', !isPhone);
  const badge = document.getElementById('device-mode-badge');
  if (badge) {
    badge.textContent = isPhone ? '📱 Phone' : '🖥️ PC';
    badge.title = isPhone ? 'Phone Mode — mobilní rozložení' : 'PC Mode — desktopové rozložení';
  }
}

/* ═══════════════════════════════════════════
   PACK OPENING
   ═══════════════════════════════════════════ */

function rollRarity(rates) {
  if (luckyNextPack) {
    luckyNextPack = false;
    rates = { common: 20, rare: 40, epic: 30, legendary: 10 };
  }
  const roll = Math.random() * 100;
  let cumulative = 0;
  for (const [rarity, chance] of Object.entries(rates)) {
    cumulative += chance;
    if (roll < cumulative) return rarity;
  }
  return 'common';
}

function rollCard(pack) {
  const cards = getAllCards().filter((c) => !c.draft);
  const rarity = rollRarity(pack.rates);
  let pool = cards.filter((c) => c.rarity === rarity && pack.filter(c));
  if (pool.length === 0) pool = cards.filter(pack.filter);
  if (pool.length === 0) pool = cards;
  return pool[Math.floor(Math.random() * pool.length)];
}

function buyPack(packId) {
  const pack = PACKS.find((p) => p.id === packId);
  if (!pack) return;
  const totalCost = pack.cost * selectedPackAmount;
  if (currentUser.coins < totalCost) return;

  currentUser.coins -= totalCost;
  persistUser();
  updateStats();

  const cards = [];
  for (let i = 0; i < selectedPackAmount; i++) cards.push(rollCard(pack));

  if (selectedPackAmount === 1) {
    openSingleOverlay(cards[0], pack);
  } else {
    openMultiOverlay(cards, pack);
  }
}

function addCardToCollection(cardId) {
  currentUser.owned[cardId] = (currentUser.owned[cardId] || 0) + 1;
}

function applyRevealAnimation(container, card) {
  container.className = 'card-flip-container reveal-pending reveal-anim-' + card.rarity;
  if (card.isBest) container.classList.add('reveal-anim-best');
}

function playRevealFlash(rarity) {
  const flash = document.getElementById('reveal-flash');
  if (!flash) return;
  flash.className = 'reveal-flash flash-' + rarity;
  flash.classList.remove('hidden');
  requestAnimationFrame(() => flash.classList.add('active'));
  setTimeout(() => {
    flash.classList.remove('active');
    setTimeout(() => flash.classList.add('hidden'), 400);
  }, rarity === 'legendary' ? 900 : rarity === 'epic' ? 600 : 400);
}

function openSingleOverlay(card, pack) {
  pendingCards = [card];
  const flip = document.getElementById('card-flip-inner');
  flip.classList.remove('is-flipped', 'is-revealed');
  const container = document.getElementById('card-flip-container');
  applyRevealAnimation(container, card);
  document.getElementById('card-front').className = 'card-face card-front rarity-' + card.rarity;
  document.getElementById('pack-overlay-title').textContent = (pack?.name || 'Balíček') + ' — Nová karta!';
  fillRevealCard(card);
  document.getElementById('btn-close-overlay').classList.add('hidden');
  document.getElementById('pack-overlay').classList.remove('hidden');
}

function fillRevealCard(card) {
  const stats = getCombatStats(card, 1);
  const ab = ABILITIES[card.ability] || ABILITIES.none;
  document.getElementById('reveal-emoji').textContent = card.emoji;
  document.getElementById('reveal-name').textContent = card.name;
  const rEl = document.getElementById('reveal-rarity');
  rEl.textContent = RARITY_LABELS[card.rarity];
  rEl.className = 'reveal-rarity ' + card.rarity;
  document.getElementById('reveal-stats').innerHTML =
    `+${formatNumber(card.baseCps)}/s · ⚔️${stats.attack} · ❤️${stats.hp}<br><small>${ab.name}: ${ab.desc}</small>`;
}

function flipSingleCard() {
  const flip = document.getElementById('card-flip-inner');
  const container = document.getElementById('card-flip-container');
  if (flip.classList.contains('is-flipped')) return;
  const card = pendingCards[0];
  flip.classList.add('is-flipped');
  container.classList.remove('reveal-pending');
  container.classList.add('is-revealed');
  playRevealFlash(card?.rarity || 'common');
  const delay = card?.rarity === 'legendary' ? 1200 : card?.rarity === 'epic' ? 900 : 700;
  setTimeout(() => document.getElementById('btn-close-overlay').classList.remove('hidden'), delay);
}

function closeSingleOverlay() {
  pendingCards.forEach((c) => addCardToCollection(c.id));
  pendingCards = [];
  document.getElementById('pack-overlay').classList.add('hidden');
  document.getElementById('card-flip-container').className = 'card-flip-container';
  persistUser();
  updateStats();
  renderCollection();
}

function openMultiOverlay(cards, pack) {
  pendingCards = cards;
  multiRevealed = new Array(cards.length).fill(false);
  document.getElementById('multi-overlay-title').textContent = pack.name + ' — ' + cards.length + ' karet!';
  const grid = document.getElementById('multi-cards-grid');
  grid.innerHTML = '';

  cards.forEach((card, i) => {
    const stats = getCombatStats(card, 1);
    const ab = ABILITIES[card.ability] || ABILITIES.none;
    const el = document.createElement('div');
    el.className = 'mini-flip reveal-pending reveal-anim-' + card.rarity + (card.isBest ? ' reveal-anim-best' : '');
    el.dataset.idx = i;
    el.innerHTML = `
      <div class="mini-flip-inner">
        <div class="mini-back">?</div>
        <div class="mini-front rarity-${card.rarity}">
          <span class="mini-emoji">${card.emoji}</span>
          <span class="mini-name">${card.name}</span>
          <span class="mini-rarity ${card.rarity}">${RARITY_LABELS[card.rarity]}</span>
          <span class="mini-stats">⚔️${stats.attack} ❤️${stats.hp}</span>
        </div>
      </div>`;
    el.addEventListener('click', () => flipMiniCard(i, el));
    grid.appendChild(el);
  });

  document.getElementById('multi-overlay').classList.remove('hidden');
}

function flipMiniCard(idx, el) {
  if (multiRevealed[idx]) return;
  multiRevealed[idx] = true;
  const inner = el.querySelector('.mini-flip-inner');
  inner.classList.add('is-flipped');
  el.classList.remove('reveal-pending');
  el.classList.add('is-revealed');
  const card = pendingCards[idx];
  if (card?.rarity === 'legendary' || card?.rarity === 'epic') {
    el.classList.add('mini-burst');
    setTimeout(() => el.classList.remove('mini-burst'), 800);
  }
}

function flipAllMini() {
  document.querySelectorAll('.mini-flip').forEach((el, i) => {
    multiRevealed[i] = true;
    el.querySelector('.mini-flip-inner').classList.add('is-flipped');
  });
}

function closeMultiOverlay() {
  pendingCards.forEach((c) => addCardToCollection(c.id));
  pendingCards = [];
  document.getElementById('multi-overlay').classList.add('hidden');
  persistUser();
  updateStats();
  renderCollection();
}

/* ═══════════════════════════════════════════
   UI RENDERING
   ═══════════════════════════════════════════ */

function updateStats() {
  document.getElementById('coins-display').textContent = formatNumber(currentUser.coins);
  document.getElementById('cps-display').textContent = '+' + formatNumber(getTotalCps()) + '/s';
  document.querySelectorAll('.pack-buy-btn').forEach((btn) => {
    const pack = PACKS.find((p) => p.id === btn.dataset.packId);
    if (pack) btn.disabled = currentUser.coins < pack.cost * selectedPackAmount;
    const priceEl = btn.querySelector('.btn-price');
    if (priceEl && pack) priceEl.textContent = (pack.cost * selectedPackAmount) + ' 🪙';
  });
}

function renderPackAmountBtns() {
  const container = document.getElementById('pack-amount-btns');
  container.innerHTML = PACK_AMOUNTS.map((n) =>
    `<button class="amount-btn${n === selectedPackAmount ? ' active' : ''}" data-amount="${n}">${n}×</button>`
  ).join('');
  container.querySelectorAll('.amount-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedPackAmount = parseInt(btn.dataset.amount, 10);
      renderPackAmountBtns();
      updateStats();
    });
  });
}

function renderPacksShop() {
  const shop = document.getElementById('packs-shop');
  shop.innerHTML = PACKS.map((pack) => `
    <div class="pack-card pack-card--${pack.id}">
      <div class="pack-card-header">
        <span class="pack-card-emoji">${pack.emoji}</span>
        <div>
          <h3 class="pack-card-name">${pack.name}</h3>
          <p class="pack-card-desc">${pack.desc}</p>
        </div>
      </div>
      <button class="btn-primary pack-buy-btn" data-pack-id="${pack.id}" ${currentUser.coins < pack.cost * selectedPackAmount ? 'disabled' : ''}>
        Otevřít ${selectedPackAmount}×
        <span class="btn-price">${pack.cost * selectedPackAmount} 🪙</span>
      </button>
    </div>`).join('');
  shop.querySelectorAll('.pack-buy-btn').forEach((btn) => {
    btn.addEventListener('click', () => buyPack(btn.dataset.packId));
  });
}

function renderCollection() {
  const grid = document.getElementById('collection-grid');
  grid.innerHTML = '';
  getAllCards().forEach((card) => {
    const level = getCardLevel(card.id);
    const owned = level > 0;
    const cps = getCardCps(card, level);
    const stats = getCombatStats(card, level || 1);
    const ab = ABILITIES[card.ability] || ABILITIES.none;
    const el = document.createElement('div');
    el.className = 'collection-card' + (owned ? ' unlocked' : ' locked');
    if (card.isBest && owned) el.classList.add('legendary-glow');
    if (card.category === 'dog' && owned) el.classList.add('dog-card');
    if (card.draft) el.classList.add('draft-card');
    if (card.publishedBy) el.classList.add('global-card');
    el.innerHTML = `
      <span class="card-emoji">${card.emoji}</span>
      <span class="card-name">${card.name}</span>
      <span class="card-rarity ${card.rarity}">${RARITY_LABELS[card.rarity]}</span>
      ${card.category === 'dog' ? '<span class="card-tag">Pejsek</span>' : ''}
      ${card.draft ? '<span class="card-tag draft-tag">Koncept</span>' : ''}
      ${card.publishedBy ? '<span class="card-tag global-tag">Update</span>' : ''}
      ${owned
        ? `<span class="card-level">Lv. ${level}</span>
           <span class="card-cps">+${formatNumber(cps)}/s</span>
           <span class="card-combat">⚔️${stats.attack} ❤️${stats.hp}</span>
           <span class="card-ability">${ab.name}</span>`
        : '<span class="card-locked-label">Zamčeno</span>'}`;
    grid.appendChild(el);
  });
}

function tickCoins() {
  const cps = getTotalCps();
  if (cps > 0) { currentUser.coins += cps; persistUser(); }
  updateStats();
}

function startTick() {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(tickCoins, 1000);
}

function switchView(viewId) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === viewId);
  });
  if (viewId === 'view-collection') renderCollection();
  if (viewId === 'view-friends') renderFriends();
  if (viewId === 'view-duel') renderDuelSetup();
  if (viewId === 'view-owner') renderOwnerPanel();
  if (viewId === 'view-shop') renderShop();
}

/* ═══════════════════════════════════════════
   FRIENDS
   ═══════════════════════════════════════════ */

function renderFriends() {
  if (!currentUser) return;
  currentUser.incomingRequests = currentUser.incomingRequests || [];
  currentUser.outgoingRequests = currentUser.outgoingRequests || [];
  currentUser.friends = currentUser.friends || [];
  currentUser.duelInvites = currentUser.duelInvites || [];

  const reqEl = document.getElementById('friend-requests');
  reqEl.innerHTML = (currentUser.incomingRequests.length === 0)
    ? '<p class="empty-msg">Žádné žádosti</p>'
    : currentUser.incomingRequests.map((from) => `
      <div class="friend-item">
        <span>${from}</span>
        <div>
          <button class="btn-small btn-accept" data-user="${from}">✓</button>
          <button class="btn-small btn-decline" data-user="${from}">✗</button>
        </div>
      </div>`).join('');

  reqEl.querySelectorAll('.btn-accept').forEach((b) => b.addEventListener('click', () => acceptFriend(b.dataset.user)));
  reqEl.querySelectorAll('.btn-decline').forEach((b) => b.addEventListener('click', () => declineFriend(b.dataset.user)));

  const listEl = document.getElementById('friend-list');
  listEl.innerHTML = (currentUser.friends.length === 0)
    ? '<p class="empty-msg">Zatím nemáš přátele. Přidej hráče podle jména!</p>'
    : currentUser.friends.map((f) => `
      <div class="friend-item">
        <span>👤 ${f}</span>
        <button class="btn-small btn-challenge" data-user="${f}">⚔️ Vyzvat</button>
      </div>`).join('');

  listEl.querySelectorAll('.btn-challenge').forEach((b) => b.addEventListener('click', () => sendDuelInvite(b.dataset.user)));

  const invEl = document.getElementById('duel-invites');
  invEl.innerHTML = (currentUser.duelInvites.length === 0)
    ? '<p class="empty-msg">Žádné výzvy</p>'
    : currentUser.duelInvites.map((inv, i) => `
      <div class="friend-item">
        <span>⚔️ ${inv.from} tě vyzval!</span>
        <button class="btn-small btn-accept-duel" data-idx="${i}">Přijmout</button>
      </div>`).join('');

  invEl.querySelectorAll('.btn-accept-duel').forEach((b) => b.addEventListener('click', () => acceptDuelInvite(parseInt(b.dataset.idx, 10))));

  const sel = document.getElementById('duel-friend-select');
  sel.innerHTML = currentUser.friends.map((f) => `<option value="${f}">${f}</option>`).join('');
}

async function addFriend() {
  const name = document.getElementById('friend-username').value.trim();
  const me = getSession();
  if (!name || name === me) return;

  const target = await DB.getUserByUsername(name);
  if (!target) { alert('Hráč "' + name + '" neexistuje.'); return; }
  if (currentUser.friends.includes(name)) { alert('Už je tvůj přítel.'); return; }
  if ((target.incomingRequests || []).includes(me)) { alert('Žádost už byla odeslána.'); return; }

  target.incomingRequests = target.incomingRequests || [];
  target.incomingRequests.push(me);
  currentUser.outgoingRequests = currentUser.outgoingRequests || [];
  currentUser.outgoingRequests.push(name);

  await DB.updateUserByUsername(name, target);
  persistUser();
  document.getElementById('friend-username').value = '';
  renderFriends();
}

async function acceptFriend(from) {
  const me = getSession();
  currentUser.incomingRequests = currentUser.incomingRequests.filter((u) => u !== from);
  if (!currentUser.friends.includes(from)) currentUser.friends.push(from);

  const other = await DB.getUserByUsername(from);
  if (other) {
    other.outgoingRequests = (other.outgoingRequests || []).filter((u) => u !== me);
    if (!other.friends.includes(me)) other.friends.push(me);
    await DB.updateUserByUsername(from, other);
  }
  persistUser();
  renderFriends();
}

async function declineFriend(from) {
  currentUser.incomingRequests = currentUser.incomingRequests.filter((u) => u !== from);
  const other = await DB.getUserByUsername(from);
  if (other) {
    other.outgoingRequests = (other.outgoingRequests || []).filter((u) => u !== getSession());
    await DB.updateUserByUsername(from, other);
  }
  persistUser();
  renderFriends();
}

async function sendDuelInvite(friendName) {
  const target = await DB.getUserByUsername(friendName);
  if (!target) return;
  target.duelInvites = target.duelInvites || [];
  target.duelInvites.push({ from: getSession(), time: Date.now() });
  await DB.updateUserByUsername(friendName, target);
  alert('Výzva odeslána hráči ' + friendName + '!');
}

function acceptDuelInvite(idx) {
  const inv = currentUser.duelInvites[idx];
  if (!inv) return;
  currentUser.duelInvites.splice(idx, 1);
  persistUser();
  duelMode = 'friend';
  document.querySelectorAll('.duel-mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === 'friend'));
  document.getElementById('friend-duel-picker').classList.remove('hidden');
  document.getElementById('duel-friend-select').value = inv.from;
  switchView('view-duel');
  renderFriends();
}

/* ═══════════════════════════════════════════
   DUEL COMBAT
   ═══════════════════════════════════════════ */

let selectedDuelCards = [];

function renderDuelSetup() {
  selectedDuelCards = [];
  document.getElementById('duel-setup').classList.remove('hidden');
  document.getElementById('duel-arena').classList.add('hidden');
  document.getElementById('friend-duel-picker').classList.toggle('hidden', duelMode !== 'friend');

  const owned = Object.entries(currentUser.owned).filter(([, lv]) => lv > 0);
  const picker = document.getElementById('duel-team-picker');
  picker.innerHTML = owned.map(([id, level]) => {
    const card = getCardById(id);
    if (!card) return '';
    const stats = getCombatStats(card, level);
    const sel = selectedDuelCards.includes(id);
    return `<button class="duel-pick-card${sel ? ' selected' : ''}" data-id="${id}">
      <span class="pick-emoji">${card.emoji}</span>
      <span class="pick-name">${card.name}</span>
      <span class="pick-stats">Lv.${level} ⚔️${stats.attack}</span>
    </button>`;
  }).join('') || '<p class="empty-msg">Nemáš žádné karty. Otevři balíček!</p>';

  picker.querySelectorAll('.duel-pick-card').forEach((btn) => {
    btn.addEventListener('click', () => toggleDuelCard(btn.dataset.id, btn));
  });
  document.getElementById('btn-start-duel').disabled = selectedDuelCards.length !== 3;
}

function toggleDuelCard(id, btn) {
  const idx = selectedDuelCards.indexOf(id);
  if (idx >= 0) {
    selectedDuelCards.splice(idx, 1);
    btn.classList.remove('selected');
  } else if (selectedDuelCards.length < 3) {
    selectedDuelCards.push(id);
    btn.classList.add('selected');
  }
  document.getElementById('btn-start-duel').disabled = selectedDuelCards.length !== 3;
}

function buildFighter(cardId, level, side) {
  const card = getCardById(cardId);
  const stats = getCombatStats(card, level);
  return {
    id: cardId, card, level, side,
    maxHp: stats.hp, hp: stats.hp, attack: stats.attack,
    ability: card.ability, alive: true,
    shield: false, poisonTurns: 0, stunned: false,
  };
}

function buildBotTeam() {
  const cards = getAllCards().filter((c) => !c.draft);
  const team = [];
  const rarities = ['common', 'common', 'rare'];
  for (const r of rarities) {
    const pool = cards.filter((c) => c.rarity === r);
    const c = pool[Math.floor(Math.random() * pool.length)];
    team.push(buildFighter(c.id, 1 + Math.floor(Math.random() * 2), 'enemy'));
  }
  return team;
}

async function buildFriendTeam(friendName) {
  const friend = await DB.getUserByUsername(friendName);
  if (!friend) return buildBotTeam();
  const owned = Object.entries(friend.owned || {}).filter(([, lv]) => lv > 0);
  if (owned.length === 0) return buildBotTeam();
  const shuffled = owned.sort(() => Math.random() - 0.5).slice(0, 3);
  return shuffled.map(([id, lv]) => buildFighter(id, lv, 'enemy'));
}

function startDuel() {
  if (selectedDuelCards.length !== 3) return;

  const playerTeam = selectedDuelCards.map((id) => buildFighter(id, getCardLevel(id), 'player'));

  const begin = async () => {
    let enemyTeam, enemyName, enemyLabel;

    if (duelMode === 'friend') {
      enemyName = document.getElementById('duel-friend-select').value;
      enemyLabel = 'PŘÍTEL';
      enemyTeam = await buildFriendTeam(enemyName);
    } else {
      enemyName = 'Bot 🤖';
      enemyLabel = 'BOT';
      enemyTeam = buildBotTeam();
    }

    duelState = {
      playerTeam, enemyTeam, enemyName, enemyLabel,
      turn: 'player', enemyIdx: 0,
      playerBuff: 0, enemyBuff: 0, log: [],
      finished: false, animating: false,
      selectedAttacker: null,
      selectedTarget: null,
      selectPhase: 'attacker',
      lastAttacker: null,
      lastVictim: null,
    };

    document.getElementById('duel-setup').classList.add('hidden');
    document.getElementById('duel-arena').classList.remove('hidden');
    document.getElementById('duel-player-name').textContent = getSession();
    document.getElementById('duel-enemy-name').textContent = enemyName;
    document.getElementById('duel-enemy-label').textContent = enemyLabel;
    document.getElementById('btn-duel-action').classList.remove('hidden');
    document.getElementById('btn-duel-back').classList.add('hidden');
    updateDuelUI();
    addDuelLog('⚔️ Souboj začíná! 1) Vyber útočníka  2) Vyber oběť  3) Útoč!');
  };

  begin();
}

function resetPlayerSelection() {
  duelState.selectedAttacker = null;
  duelState.selectedTarget = null;
  duelState.selectPhase = 'attacker';
}

function updateDuelUI() {
  if (!duelState) return;
  renderDuelArena();
  updateTurnBanner();
  updateDuelControls();
}

function getSelectedAttacker() {
  if (duelState.selectedAttacker === null) return null;
  const f = duelState.playerTeam[duelState.selectedAttacker];
  return f?.alive ? f : null;
}

function getSelectedTarget() {
  if (duelState.selectedTarget === null) return null;
  const f = duelState.enemyTeam[duelState.selectedTarget];
  return f?.alive ? f : null;
}

function updateTurnBanner() {
  const banner = document.getElementById('duel-turn-banner');
  const hint = document.getElementById('duel-target-hint');
  if (!banner || duelState.finished) return;

  if (duelState.animating) {
    banner.className = 'duel-turn-banner animating';
    banner.textContent = '⚡ Útok probíhá...';
    return;
  }

  if (duelState.turn === 'player') {
    banner.className = 'duel-turn-banner player-turn';
    if (duelState.selectPhase === 'attacker') {
      banner.textContent = `🟢 Krok 1 — Vyber ÚTOČNÍKA (${getSession()})`;
      if (hint) { hint.textContent = '👆 Klepni na svou kartu (zelený tým)'; hint.classList.remove('hidden'); }
    } else if (duelState.selectPhase === 'target') {
      const atk = getSelectedAttacker();
      banner.textContent = atk
        ? `🟢 Krok 2 — ${atk.card.emoji} ${atk.card.name} útočí! Vyber OBĚŤ`
        : `🟢 Krok 2 — Vyber OBĚŤ`;
      if (hint) { hint.textContent = '👆 Klepni na nepřátelskou kartu (červený tým)'; hint.classList.remove('hidden'); }
    } else {
      banner.textContent = `🟢 Připraveno k útoku!`;
      if (hint) { hint.textContent = '⚔️ Klepni „ÚTOČIT!“'; hint.classList.remove('hidden'); }
    }
  } else {
    banner.className = 'duel-turn-banner enemy-turn';
    banner.textContent = `🔴 Na řadě: ${duelState.enemyLabel} (${duelState.enemyName})`;
    if (hint) hint.classList.add('hidden');
  }
}

function updateDuelControls() {
  const btn = document.getElementById('btn-duel-action');
  if (!btn || duelState.finished) return;
  if (duelState.turn === 'player' && !duelState.animating) {
    const ready = duelState.selectedAttacker !== null && duelState.selectedTarget !== null;
    btn.textContent = ready ? '⚔️ ÚTOČIT!' : 'Vyber útočníka a oběť';
    btn.disabled = !ready;
  } else {
    btn.disabled = true;
    btn.textContent = duelState.turn === 'enemy' ? 'Soupeř útočí...' : 'ÚTOČIT!';
  }
}

function renderDuelArena() {
  if (!duelState) return;

  const renderTeam = (team, containerId, side) => {
    const container = document.getElementById(containerId);
    container.innerHTML = team.map((f, idx) => {
      const pct = Math.max(0, (f.hp / f.maxHp) * 100);
      let classes = 'duel-card';
      if (!f.alive) classes += ' dead';

      if (side === 'player') {
        if (duelState.selectedAttacker === idx) classes += ' is-attacker';
        else if (f.alive && duelState.turn === 'player' && !duelState.animating) {
          classes += ' pick-attacker';
        }
      } else {
        if (duelState.selectedTarget === idx) classes += ' is-target';
        else if (f.alive && duelState.turn === 'player' && !duelState.animating &&
                 duelState.selectedAttacker !== null) {
          classes += ' pick-target';
        }
      }

      const idxAttr = side === 'player' ? ` data-player-idx="${idx}"` : ` data-enemy-idx="${idx}"`;
      return `<div class="${classes}"${idxAttr} role="button" tabindex="0">
        <span class="duel-emoji">${f.card.emoji}</span>
        <span class="duel-name">${f.card.name}</span>
        <div class="hp-bar"><div class="hp-fill" style="width:${pct}%"></div></div>
        <span class="duel-hp">${Math.max(0, f.hp)}/${f.maxHp}</span>
      </div>`;
    }).join('');
  };

  renderTeam(duelState.playerTeam, 'duel-player-cards', 'player');
  renderTeam(duelState.enemyTeam, 'duel-enemy-cards', 'enemy');

  const logEl = document.getElementById('duel-log');
  if (logEl) {
    logEl.innerHTML = duelState.log.slice(-10).map((l) => `<p>${l}</p>`).join('');
    logEl.scrollTop = logEl.scrollHeight;
  }
}

function selectDuelAttacker(playerIdx) {
  if (duelState.finished || duelState.turn !== 'player' || duelState.animating) return;
  const fighter = duelState.playerTeam[playerIdx];
  if (!fighter?.alive) return;

  duelState.selectedAttacker = playerIdx;
  duelState.selectedTarget = null;
  duelState.selectPhase = 'target';
  updateDuelUI();
}

function selectDuelTarget(enemyIdx) {
  if (duelState.finished || duelState.turn !== 'player' || duelState.animating) return;
  if (duelState.selectedAttacker === null) return;
  const enemy = duelState.enemyTeam[enemyIdx];
  if (!enemy?.alive) return;

  duelState.selectedTarget = enemyIdx;
  duelState.selectPhase = 'ready';
  updateDuelUI();
}

function onDuelArenaClick(e) {
  const card = e.target.closest('.duel-card');
  if (!card || duelState?.finished || duelState?.animating) return;

  if (card.dataset.playerIdx !== undefined) {
    selectDuelAttacker(parseInt(card.dataset.playerIdx, 10));
  } else if (card.dataset.enemyIdx !== undefined) {
    selectDuelTarget(parseInt(card.dataset.enemyIdx, 10));
  }
}

function showDamagePopup(targetEl, dmg) {
  const layer = document.getElementById('duel-fx-layer');
  if (!layer || !targetEl) return;
  const rect = targetEl.getBoundingClientRect();
  const arena = document.getElementById('duel-arena').getBoundingClientRect();
  const pop = document.createElement('span');
  pop.className = 'dmg-popup';
  pop.textContent = '-' + dmg;
  pop.style.left = (rect.left - arena.left + rect.width / 2 - 20) + 'px';
  pop.style.top = (rect.top - arena.top) + 'px';
  layer.appendChild(pop);
  setTimeout(() => pop.remove(), 900);
}

function playAttackAnim(attackerSide, attackerIdx, targetIdx, dmg, callback) {
  duelState.animating = true;
  duelState.lastAttacker = attackerSide === 'player'
    ? duelState.playerTeam[attackerIdx]
    : duelState.enemyTeam[attackerIdx];
  duelState.lastVictim = attackerSide === 'player'
    ? duelState.enemyTeam[targetIdx]
    : duelState.playerTeam[targetIdx];
  updateDuelUI();

  const atkContainer = attackerSide === 'player' ? 'duel-player-cards' : 'duel-enemy-cards';
  const vicContainer = attackerSide === 'player' ? 'duel-enemy-cards' : 'duel-player-cards';

  requestAnimationFrame(() => {
    const atkEl = document.getElementById(atkContainer)?.children[attackerIdx];
    const vicEl = document.getElementById(vicContainer)?.children[targetIdx];
    atkEl?.classList.add('anim-attack');
    setTimeout(() => {
      vicEl?.classList.add('anim-hit');
      if (vicEl) showDamagePopup(vicEl, dmg);
      document.getElementById('duel-field')?.classList.add('screen-shake');
    }, 220);
  });

  setTimeout(() => {
    document.getElementById('duel-field')?.classList.remove('screen-shake');
    duelState.lastAttacker = null;
    duelState.lastVictim = null;
    callback();
  }, 900);
}

function addDuelLog(msg) {
  duelState.log.push(msg);
  const logEl = document.getElementById('duel-log');
  if (logEl) {
    logEl.innerHTML = duelState.log.slice(-10).map((l) => `<p>${l}</p>`).join('');
    logEl.scrollTop = logEl.scrollHeight;
  }
}

function getAlive(team) {
  return team.filter((f) => f.alive && f.hp > 0);
}

function calcDamage(attacker, defender, buff) {
  let dmg = attacker.attack;
  if (attacker.ability === 'bite') dmg *= 1.5;
  if (attacker.ability === 'rage' && attacker.hp / attacker.maxHp < 0.3) dmg *= 2;
  if (attacker.ability === 'cosmic') dmg *= 1.8;
  if (buff) dmg *= 1 + buff;
  if (defender.shield) { dmg *= 0.6; defender.shield = false; }
  return Math.round(dmg);
}

function applyAttack(attacker, defender, buff) {
  if (attacker.ability === 'stun' && Math.random() < 0.2) {
    defender.stunned = true;
    addDuelLog(`💫 ${attacker.card.name} omráčil ${defender.card.name}!`);
  }
  const dmg = calcDamage(attacker, defender, buff);
  defender.hp -= dmg;
  addDuelLog(`🟢 ${attacker.card.emoji} ${attacker.card.name} → 🔴 ${defender.card.name}: <b>${dmg}</b> dmg`);

  if (attacker.ability === 'lifesteal') {
    attacker.hp = Math.min(attacker.maxHp, attacker.hp + Math.round(dmg * 0.25));
    addDuelLog(`💚 ${attacker.card.name} vysál ${Math.round(dmg * 0.25)} HP`);
  }
  if (attacker.ability === 'splash') {
    const team = defender.side === 'enemy' ? duelState.enemyTeam : duelState.playerTeam;
    const others = team.filter((f) => f.alive && f !== defender);
    if (others.length) {
      const splashDmg = Math.round(dmg * 0.4);
      others[0].hp -= splashDmg;
      addDuelLog(`🌊 Vlna zasáhla ${others[0].card.name} za ${splashDmg}!`);
      if (others[0].hp <= 0) { others[0].alive = false; others[0].hp = 0; }
    }
  }
  if (defender.hp <= 0) {
    defender.alive = false;
    defender.hp = 0;
    addDuelLog(`💀 ${defender.card.name} je poražen!`);
  }
  return dmg;
}

function applyAbilityHeals(team, fighter) {
  if (fighter.ability === 'heal') {
    team.forEach((f) => {
      if (f.alive) f.hp = Math.min(f.maxHp, f.hp + Math.round(f.maxHp * 0.15));
    });
    addDuelLog(`${fighter.card.name} vyléčil tým!`);
  }
  if (fighter.ability === 'shield') fighter.shield = true;
  if (fighter.ability === 'howl') {
    if (fighter.side === 'player') duelState.playerBuff = 0.2;
    else duelState.enemyBuff = 0.2;
    addDuelLog(`${fighter.card.name} zvýšil dmg týmu!`);
  }
}

function applyPoison(team) {
  team.forEach((f) => {
    if (f.alive && f.poisonTurns > 0) {
      f.hp -= 5;
      f.poisonTurns--;
      addDuelLog(`${f.card.name} trpí jedem (-5)`);
      if (f.hp <= 0) { f.alive = false; f.hp = 0; }
    }
    if (f.alive && f.ability === 'poison') {
      const enemies = f.side === 'player' ? duelState.enemyTeam : duelState.playerTeam;
      const target = getAlive(enemies)[0];
      if (target) target.poisonTurns = 3;
    }
  });
}

function executePlayerAttack() {
  if (duelState.finished || duelState.turn !== 'player' || duelState.animating) return;
  if (duelState.selectedAttacker === null || duelState.selectedTarget === null) return;

  const attacker = duelState.playerTeam[duelState.selectedAttacker];
  const defender = duelState.enemyTeam[duelState.selectedTarget];
  if (!attacker?.alive || !defender?.alive) return;

  const atkIdx = duelState.selectedAttacker;
  const tgtIdx = duelState.selectedTarget;
  const previewDmg = calcDamage(attacker, defender, duelState.playerBuff);

  playAttackAnim('player', atkIdx, tgtIdx, previewDmg, () => {
    if (attacker.stunned) {
      attacker.stunned = false;
      addDuelLog(`😵 ${attacker.card.name} je omráčen a neútočí!`);
    } else {
      applyAbilityHeals(duelState.playerTeam, attacker);
      applyAttack(attacker, defender, duelState.playerBuff);
    }

    resetPlayerSelection();
    duelState.turn = 'enemy';
    duelState.animating = false;

    applyPoison(duelState.playerTeam);
    applyPoison(duelState.enemyTeam);

    if (getAlive(duelState.playerTeam).length === 0 || getAlive(duelState.enemyTeam).length === 0) {
      endDuel();
    } else {
      updateDuelUI();
      setTimeout(() => executeEnemyAttack(), 600);
    }
  });
}

function executeEnemyAttack() {
  if (duelState.finished) return;

  const alive = getAlive(duelState.enemyTeam);
  const playerTargets = getAlive(duelState.playerTeam);
  if (!alive.length || !playerTargets.length) return endDuel();

  const attacker = alive[duelState.enemyIdx % alive.length];
  const atkIdx = duelState.enemyTeam.indexOf(attacker);
  const defender = playerTargets[Math.floor(Math.random() * playerTargets.length)];
  const tgtIdx = duelState.playerTeam.indexOf(defender);
  const previewDmg = calcDamage(attacker, defender, duelState.enemyBuff);

  duelState.animating = true;
  updateDuelUI();

  playAttackAnim('enemy', atkIdx, tgtIdx, previewDmg, () => {
    if (attacker.stunned) {
      attacker.stunned = false;
      addDuelLog(`😵 ${attacker.card.name} je omráčen!`);
    } else {
      applyAbilityHeals(duelState.enemyTeam, attacker);
      applyAttack(attacker, defender, duelState.enemyBuff);
    }

    duelState.enemyIdx++;
    duelState.turn = 'player';
    duelState.animating = false;
    resetPlayerSelection();

    applyPoison(duelState.playerTeam);
    applyPoison(duelState.enemyTeam);

    if (getAlive(duelState.playerTeam).length === 0 || getAlive(duelState.enemyTeam).length === 0) {
      endDuel();
    } else {
      updateDuelUI();
    }
  });
}

function duelTurn() {
  if (duelState.finished || duelState.animating) return;
  if (duelState.turn === 'player') executePlayerAttack();
}

function endDuel() {
  const playerAlive = getAlive(duelState.playerTeam).length;
  const enemyAlive = getAlive(duelState.enemyTeam).length;
  let won = playerAlive > enemyAlive;

  if (won) {
    currentUser.coins += 25;
    currentUser.wins = (currentUser.wins || 0) + 1;
    addDuelLog('🏆 Vítězství! +25 🪙');
  } else {
    currentUser.losses = (currentUser.losses || 0) + 1;
    addDuelLog('💀 Prohra...');
  }
  duelState.finished = true;
  duelState.lastAttacker = null;
  duelState.lastVictim = null;
  persistUser();
  updateStats();
  updateTurnBanner();
  document.getElementById('duel-turn-banner').textContent = won
    ? '🏆 VÍTĚZSTVÍ! +25 🪙'
    : '💀 PROHRA';
  document.getElementById('duel-turn-banner').className = won ? 'duel-turn-banner win' : 'duel-turn-banner lose';
  document.getElementById('duel-target-hint')?.classList.add('hidden');
  document.getElementById('btn-duel-action').classList.add('hidden');
  document.getElementById('btn-duel-back').classList.remove('hidden');
}

/* ═══════════════════════════════════════════
   OWNER PANEL
   ═══════════════════════════════════════════ */

function renderOwnerPanel() {
  if (currentUser.rank !== 'owner') return;

  const drafts = getOwnerDrafts();
  const globalCount = getGlobalCards().length;
  const ver = getGlobalVersion();

  const publishBtn = document.getElementById('btn-publish-update');
  const publishInfo = document.getElementById('publish-info');
  if (publishBtn) {
    publishBtn.disabled = drafts.length === 0;
    publishBtn.textContent = drafts.length > 0
      ? `🚀 Vydat aktualizaci (${drafts.length} ${drafts.length === 1 ? 'karta' : drafts.length < 5 ? 'karty' : 'karet'})`
      : '🚀 Vydat aktualizaci';
  }
  if (publishInfo) {
    publishInfo.textContent = `Verze ${ver} · ${globalCount} vydaných karet · ${drafts.length} konceptů čeká`;
  }

  const list = document.getElementById('owner-cards-list');
  const customs = currentUser.customCards || [];
  list.innerHTML = customs.length === 0
    ? '<p class="empty-msg">Zatím žádné koncepty. Vytvoř kartu a pak ji vydáš aktualizací.</p>'
    : customs.map((c) => `
      <div class="owner-card-item">
        <span>${c.emoji} ${c.name}</span>
        <span class="card-rarity ${c.rarity}">${RARITY_LABELS[c.rarity]}</span>
        <span>${c.draft ? '📝 Koncept' : '✅ Vydáno'}</span>
        <span>⚔️${c.attack} ❤️${c.hp}</span>
      </div>`).join('');

  const globalList = document.getElementById('owner-global-list');
  if (globalList) {
    const globals = getGlobalCards();
    globalList.innerHTML = globals.length === 0
      ? '<p class="empty-msg">Zatím žádné vydané karty.</p>'
      : globals.slice(-10).reverse().map((c) => `
        <div class="owner-card-item">
          <span>${c.emoji} ${c.name}</span>
          <span class="card-rarity ${c.rarity}">${RARITY_LABELS[c.rarity]}</span>
          <span class="global-tag-inline">v${c.publishedVersion || '?'}</span>
        </div>`).join('');
  }
}

async function publishGameUpdate() {
  if (currentUser.rank !== 'owner') return;

  const drafts = getOwnerDrafts();
  if (drafts.length === 0) {
    alert('Nemáš žádné koncepty k vydání. Nejdřív vytvoř karty.');
    return;
  }

  if (!confirm(`Vydat aktualizaci s ${drafts.length} novými kartami? Uvidí je všichni hráči.`)) return;

  await DB.refreshGlobal();
  const newVersion = getGlobalVersion() + 1;
  const globalCards = [...getGlobalCards()];
  const existingIds = new Set(globalCards.map((c) => c.id));

  drafts.forEach((draft) => {
    if (existingIds.has(draft.id)) return;
    const published = { ...draft, draft: false, publishedBy: OWNER_USERNAME, publishedVersion: newVersion };
    delete published.ownerOnly;
    globalCards.push(published);
    existingIds.add(draft.id);
  });

  currentUser.customCards = (currentUser.customCards || []).map((c) =>
    c.draft ? { ...c, draft: false, publishedVersion: newVersion } : c
  );

  await DB.saveGlobal(globalCards, newVersion);
  persistUser();
  renderOwnerPanel();
  renderCollection();
  alert(`Aktualizace v${newVersion} vydána! ${drafts.length} karet je teď dostupných pro všechny hráče.`);
}

function createOwnerCard(e) {
  e.preventDefault();
  if (currentUser.rank !== 'owner') return;

  const name = document.getElementById('oc-name').value.trim();
  const emoji = document.getElementById('oc-emoji').value.trim();
  const rarity = document.getElementById('oc-rarity').value;
  const baseCps = parseInt(document.getElementById('oc-cps').value, 10) || 5;
  const attack = parseInt(document.getElementById('oc-atk').value, 10) || 10;
  const hp = parseInt(document.getElementById('oc-hp').value, 10) || 30;
  const ability = document.getElementById('oc-ability').value;

  const id = 'custom_' + Date.now();
  const card = {
    id, name, emoji, rarity, baseCps, attack, hp, ability,
    category: 'custom', draft: true,
  };

  currentUser.customCards = currentUser.customCards || [];
  currentUser.customCards.push(card);
  currentUser.owned[id] = (currentUser.owned[id] || 0) + 1;
  persistUser();
  document.getElementById('owner-card-form').reset();
  renderOwnerPanel();
  renderCollection();
  alert('Koncept "' + name + '" vytvořen. Až budeš ready, klikni „Vydat aktualizaci“.');
}

/* ═══════════════════════════════════════════
   INIT & EVENTS
   ═══════════════════════════════════════════ */

document.getElementById('form-login').addEventListener('submit', (e) => {
  e.preventDefault();
  login(document.getElementById('login-user').value, document.getElementById('login-pass').value);
});

document.getElementById('form-register').addEventListener('submit', (e) => {
  e.preventDefault();
  register(document.getElementById('reg-user').value, document.getElementById('reg-pass').value);
});

document.querySelectorAll('.login-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.login-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('form-login').classList.toggle('hidden', tab.dataset.tab !== 'login');
    document.getElementById('form-register').classList.toggle('hidden', tab.dataset.tab !== 'register');
    showAuthError('');
  });
});

document.getElementById('btn-logout').addEventListener('click', logout);
document.getElementById('card-back').addEventListener('click', flipSingleCard);
document.getElementById('card-flip-inner').addEventListener('click', flipSingleCard);
document.getElementById('btn-close-overlay').addEventListener('click', closeSingleOverlay);
document.getElementById('btn-flip-all').addEventListener('click', flipAllMini);
document.getElementById('btn-done-multi').addEventListener('click', closeMultiOverlay);
document.getElementById('btn-add-friend').addEventListener('click', addFriend);
document.getElementById('btn-start-duel').addEventListener('click', startDuel);
document.getElementById('duel-arena').addEventListener('click', onDuelArenaClick);
document.getElementById('btn-duel-action').addEventListener('click', duelTurn);
document.getElementById('btn-duel-back').addEventListener('click', () => renderDuelSetup());
document.getElementById('owner-card-form').addEventListener('submit', createOwnerCard);
document.getElementById('btn-publish-update')?.addEventListener('click', publishGameUpdate);
document.getElementById('btn-dismiss-update')?.addEventListener('click', dismissUpdateBanner);

window.addEventListener('resize', applyDeviceMode);
window.addEventListener('orientationchange', applyDeviceMode);

document.querySelectorAll('.duel-mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    duelMode = btn.dataset.mode;
    document.querySelectorAll('.duel-mode-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('friend-duel-picker').classList.toggle('hidden', duelMode !== 'friend');
  });
});

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

(function init() {
  applyDeviceMode();

  (async () => {
    await DB.init();

    if (DB.isOnline()) {
      document.getElementById('offline-notice')?.classList.add('hidden');
      DB.onAuthChanged((profile, alreadyInApp) => {
        if (profile) {
          const theme = profile.activeTheme || 'default';
          currentUser = profile;
          if (alreadyInApp) {
            applyTheme(theme, true);
            updateStats();
            renderFriends();
            renderCollection();
            renderShop();
          } else {
            enterApp();
          }
        } else {
          currentUser = null;
          if (tickInterval) clearInterval(tickInterval);
          document.getElementById('login-screen').classList.remove('hidden');
          document.getElementById('app').classList.add('hidden');
        }
      });
    } else {
      document.getElementById('offline-notice')?.classList.remove('hidden');
      const session = getSession();
      if (session) {
        currentUser = await DB.getUserByUsername(session);
        if (currentUser) {
          currentUser.username = session;
          if (session === OWNER_USERNAME) currentUser.rank = 'owner';
          enterApp();
        }
      }
    }
  })();
})();
