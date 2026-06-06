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
  getAllCards().forEach((card) => {
    const lvl = getCardLevel(card.id);
    if (lvl > 0) {
      total += card.cps * lvl;
    }
  });
  return total;
}

function updateStats() {
  if (!currentUser) return;
  const coinsDisplay = document.getElementById('coins-display');
  if (coinsDisplay) coinsDisplay.textContent = Math.floor(currentUser.coins);

  const cpsDisplay = document.getElementById('cps-display');
  if (cpsDisplay) cpsDisplay.textContent = `+${getTotalCps()}/s`;

  const albumCount = document.getElementById('album-count');
  if (albumCount) {
    const ownedCount = Object.keys(currentUser.owned).filter(id => currentUser.owned[id] > 0).length;
    albumCount.textContent = `${ownedCount} / ${getAllCards().length}`;
  }
}

async function triggerAutoSave() {
  if (currentUser) {
    await DB.persistUser(currentUser);
  }
}

function startTicker() {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(() => {
    if (currentUser) {
      currentUser.coins += getTotalCps();
      updateStats();
    }
  }, 1000);

  // Auto-save do cloudu každých 10 sekund
  setInterval(triggerAutoSave, 10000);
}

function applyTheme(themeId, applyToBody = true) {
  const t = THEMES[themeId] || THEMES.default;
  const target = applyToBody ? document.documentElement : document.querySelector('.device-content');
  if (!target) return;
  Object.keys(t.vars).forEach((v) => {
    target.style.setProperty(v, t.vars[v]);
  });
}

function switchView(viewId) {
  document.querySelectorAll('.view-section').forEach((s) => s.classList.add('hidden'));
  const currentView = document.getElementById(`view-${viewId}`);
  if (currentView) currentView.classList.remove('hidden');

  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
  const activeBtn = document.querySelector(`.nav-btn[data-view="${viewId}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  if (viewId === 'collection') renderCollection();
  if (viewId === 'shop') renderShop();
  if (viewId === 'friends') renderFriends();
}

function renderCollection() {
  const grid = document.getElementById('collection-grid');
  if (!grid) return;
  grid.innerHTML = '';

  getAllCards().forEach((card) => {
    const lvl = getCardLevel(card.id);
    const div = document.createElement('div');
    div.className = `card ${lvl === 0 ? 'locked' : ''} card--${card.rarity}`;
    if (card.id === 'dog_havanese' && lvl > 0) div.classList.add('reveal-anim-best');

    div.innerHTML = `
      <div class="card-level">${lvl > 0 ? 'Lv.' + lvl : 'ZAMČENO'}</div>
      <div class="card-emoji">${card.emoji}</div>
      <div class="card-name">${card.name}</div>
      <div class="card-rarity-label">${RARITY_LABELS[card.rarity]}</div>
      <div class="card-info">⚔️ ${card.atk} | ❤️ ${card.hp}</div>
      <div class="card-cps-label">+${card.cps * (lvl || 1)} CPS</div>
    `;
    grid.appendChild(div);
  });
}

function renderShop() {
  const shopGrid = document.getElementById('shop-items-grid');
  if (!shopGrid) return;
  shopGrid.innerHTML = '';

  SHOP_ITEMS.forEach((item) => {
    const div = document.createElement('div');
    const owned = currentUser?.shopOwned?.themes?.includes(item.themeId);
    div.className = `shop-item ${owned ? 'owned' : ''}`;

    div.innerHTML = `
      <div class="shop-item-emoji">${item.emoji}</div>
      <div class="shop-item-name">${item.name}</div>
      <div class="shop-item-desc">${item.desc}</div>
      ${owned 
        ? `<div class="shop-owned-badge">Vlastněno</div>` 
        : `<button class="btn-primary shop-buy-btn" onclick="buyShopItem('${item.id}')">${item.cost} 🪙</button>`
      }
    `;
    shopGrid.appendChild(div);
  });
}

async function buyShopItem(id) {
  const item = SHOP_ITEMS.find(i => i.id === id);
  if (!item || !currentUser) return;
  if (currentUser.coins < item.cost) {
    alert('Nedostatek mincí!');
    return;
  }
  currentUser.coins -= item.cost;
  if (!currentUser.shopOwned.themes) currentUser.shopOwned.themes = ['default'];
  currentUser.shopOwned.themes.push(item.themeId);
  
  updateStats();
  renderShop();
  await DB.persistUser(currentUser);
}

function drawRandomCard() {
  const cards = getAllCards();
  const rand = Math.random() * 100;
  let rarity = 'common';

  if (luckyNextPack) {
    if (rand < 40) rarity = 'legendary';
    else if (rand < 80) rarity = 'epic';
    else rarity = 'rare';
    luckyNextPack = false;
  } else {
    if (rand < 60) rarity = 'common';
    else if (rand < 85) rarity = 'rare';
    else if (rand < 99) rarity = 'epic';
    else rarity = 'legendary';
  }

  const pool = cards.filter(c => c.rarity === rarity);
  if (pool.length === 0) return cards[0];
  return pool[Math.floor(Math.random() * pool.length)];
}

async function buyPack() {
  if (!currentUser) return;
  const cost = selectedPackAmount * 50;
  if (currentUser.coins < cost) {
    alert('Nedostatek mincí!');
    return;
  }

  currentUser.coins -= cost;
  pendingCards = [];
  for (let i = 0; i < selectedPackAmount; i++) {
    pendingCards.push(drawRandomCard());
  }

  // Připsání karet
  pendingCards.forEach((card) => {
    if (!currentUser.owned[card.id]) currentUser.owned[card.id] = 0;
    currentUser.owned[card.id]++;
  });

  updateStats();
  await DB.persistUser(currentUser); // Okamžitý save po rozbalení cloudu!

  if (selectedPackAmount === 1) {
    showSingleReveal(pendingCards[0]);
  } else {
    showMultiReveal(pendingCards);
  }
}

function showSingleReveal(card) {
  const overlay = document.getElementById('reveal-overlay');
  const inner = document.getElementById('card-inner');
  const front = document.getElementById('card-front');
  
  front.className = `card-face card-front card--${card.rarity}`;
  if (card.id === 'dog_havanese') front.classList.add('reveal-anim-best');

  document.getElementById('reveal-emoji').textContent = card.emoji;
  document.getElementById('reveal-name').textContent = card.name;
  document.getElementById('reveal-rarity').textContent = RARITY_LABELS[card.rarity];
  document.getElementById('reveal-stats').textContent = `⚔️ ${card.atk} | ❤️ ${card.hp} (+${card.cps} CPS)`;

  inner.classList.remove('is-flipped');
  overlay.classList.remove('hidden');
  document.getElementById('btn-close-overlay').classList.add('hidden');
}

function showMultiReveal(cards) {
  const overlay = document.getElementById('multi-overlay');
  const grid = document.getElementById('multi-cards-grid');
  grid.innerHTML = '';
  multiRevealed = new Array(cards.length).fill(false);

  cards.forEach((card, idx) => {
    const container = document.createElement('div');
    container.className = 'card-container';
    container.innerHTML = `
      <div class="card-inner" id="multi-inner-${idx}">
        <div class="card-face card-back">📦</div>
        <div class="card-face card-front card--${card.rarity} ${card.id === 'dog_havanese' ? 'reveal-anim-best' : ''}">
          <div class="reveal-emoji" style="font-size:2rem;">${card.emoji}</div>
          <div style="font-weight:bold; font-size:0.8rem; margin:4px 0;">${card.name}</div>
          <div style="font-size:0.65rem; opacity:0.8;">${RARITY_LABELS[card.rarity]}</div>
        </div>
      </div>
    `;
    container.addEventListener('click', () => flipMultiCard(idx));
    grid.appendChild(container);
  });

  overlay.classList.remove('hidden');
}

function flipMultiCard(idx) {
  const inner = document.getElementById(`multi-inner-${idx}`);
  if (inner && !multiRevealed[idx]) {
    inner.classList.add('is-flipped');
    multiRevealed[idx] = true;
  }
}

function applyDeviceMode() {
  const isDesktop = window.innerWidth > 768;
  document.body.classList.toggle('desktop-mode', isDesktop);
}

async function enterApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  
  const theme = currentUser?.activeTheme || 'default';
  applyTheme(theme, true);
  
  updateStats();
  switchView('clicker');
  startTicker();
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  window.addEventListener('resize', applyDeviceMode);

  document.getElementById('click-btn')?.addEventListener('click', () => {
    if (currentUser) {
      currentUser.coins += 1;
      updateStats();
    }
  });

  document.getElementById('btn-buy-pack')?.addEventListener('click', buyPack);
  
  document.getElementById('pack-amount')?.addEventListener('change', (e) => {
    selectedPackAmount = parseInt(e.target.value) || 1;
  });

  document.getElementById('card-inner')?.addEventListener('click', () => {
    const inner = document.getElementById('card-inner');
    if (inner && !inner.classList.contains('is-flipped')) {
      inner.classList.add('is-flipped');
      document.getElementById('btn-close-overlay').classList.remove('hidden');
    }
  });

  document.getElementById('btn-close-overlay')?.addEventListener('click', () => {
    document.getElementById('reveal-overlay').classList.add('hidden');
  });

  document.getElementById('btn-flip-all')?.addEventListener('click', () => {
    pendingCards.forEach((_, idx) => flipMultiCard(idx));
  });

  document.getElementById('btn-done-multi')?.addEventListener('click', () => {
    document.getElementById('multi-overlay').classList.add('hidden');
  });

  // Autentizační formuláře
  document.getElementById('form-login')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = document.getElementById('login-user').value;
    const p = document.getElementById('login-pass').value;
    try {
      currentUser = await DB.login(u, p);
      await enterApp();
    } catch(err) {
      alert(err.message);
    }
  });

  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await DB.logout();
    location.reload();
  });
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
          enterApp();
        }
      }
    }
  })();
})();