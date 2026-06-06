'use strict';

const OWNER_USERNAME = 'GalaxiBrainCZ';

const RARITY_LABELS = {
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};

const ABILITIES = {
  none:    { name: 'Bez schopnosti', desc: 'Normální útok.' },
  bite:    { name: 'Kousnutí', desc: '+50 % poškození při útoku.' },
  heal:    { name: 'Léčení', desc: 'Obnoví 15 % HP týmu.' },
  shield:  { name: 'Štít', desc: 'Sníží příchozí dmg o 40 % na 1 kolo.' },
  poison:  { name: 'Jed', desc: 'Způsobí 5 dmg každé kolo po dobu 3 kol.' },
  rage:    { name: 'Zuřivost', desc: 'Pod 30 % HP zdvojnásobí útok.' },
  splash:  { name: 'Vlna', desc: 'Poškodí i vedlejší nepřátelskou kartu.' },
  stun:    { name: 'Omráčení', desc: '20 % šance vynechat nepřátelský útok.' },
  lifesteal:{ name: 'Vysátí', desc: 'Vyléčí se za 25 % způsobeného dmg.' },
  howl:    { name: 'Vytí', desc: 'Zvýší dmg celého týmu o 20 % na 2 kola.' },
  cosmic:  { name: 'Kosmický úder', desc: 'Ignoruje štít, +80 % dmg.' },
};

const PACK_AMOUNTS = [1, 2, 3, 4, 5, 10];

const PACKS = [
  { id: 'starter',  name: 'Startovací balíček', emoji: '🎁', cost: 25,  desc: 'Levný vstup — common a rare.', rates: { common: 80, rare: 18, epic: 1.8, legendary: 0.2 }, filter: () => true },
  { id: 'basic',    name: 'Základní balíček',   emoji: '📦', cost: 35,  desc: 'Náhodný mazlíček nebo předmět.', rates: { common: 72, rare: 23, epic: 4.5, legendary: 0.5 }, filter: () => true },
  { id: 'pet',      name: 'Balíček mazlíčků',   emoji: '🐾', cost: 80,  desc: 'Jen zvířata.', rates: { common: 58, rare: 30, epic: 10.5, legendary: 1.5 }, filter: (c) => c.category !== 'item' },
  { id: 'cat',      name: 'Kočičí balíček',     emoji: '🐈', cost: 95,  desc: 'Kočky a kočkovité šelmy.', rates: { common: 50, rare: 35, epic: 13, legendary: 2 }, filter: (c) => ['cat', 'other'].includes(c.category) && c.id !== 'havanese' },
  { id: 'dog',      name: 'Pejsků balíček',     emoji: '🐶', cost: 160, desc: 'Pouze pejsci! Šance na Havanského psíka.', rates: { common: 42, rare: 36, epic: 19, legendary: 3 }, filter: (c) => c.category === 'dog' },
  { id: 'wild',     name: 'Divoký balíček',     emoji: '🦁', cost: 140, desc: 'Exotická zvířata a dravci.', rates: { common: 45, rare: 38, epic: 15, legendary: 2 }, filter: (c) => ['bird', 'reptile', 'other', 'cat'].includes(c.category) },
  { id: 'ocean',    name: 'Oceánský balíček',   emoji: '🌊', cost: 110, desc: 'Ryby, žáby a vodní tvorové.', rates: { common: 55, rare: 32, epic: 11.5, legendary: 1.5 }, filter: (c) => ['fish', 'amphibian'].includes(c.category) || ['fish', 'octopus', 'whale', 'crab', 'jellyfish'].includes(c.id) },
  { id: 'premium',  name: 'Premium balíček',    emoji: '✨', cost: 320, desc: 'Nejlepší šance na epic a legendary.', rates: { common: 38, rare: 34, epic: 24, legendary: 4 }, filter: () => true },
  { id: 'legendary',name: 'Legendární balíček', emoji: '👑', cost: 500, desc: 'Garantovaně vyšší rarita!', rates: { common: 10, rare: 35, epic: 40, legendary: 15 }, filter: () => true },
  { id: 'mega',     name: 'Mega balíček',       emoji: '💎', cost: 750, desc: 'Největší šance na top karty.', rates: { common: 5, rare: 25, epic: 45, legendary: 25 }, filter: () => true },
];

/** Staty podle rarity — pejsci dostanou bonus v getCombatStats */
const RARITY_STATS = {
  common:    { attack: 6,  hp: 24 },
  rare:      { attack: 12, hp: 42 },
  epic:      { attack: 24, hp: 72 },
  legendary: { attack: 48, hp: 120 },
};

function makeCard(id, name, emoji, rarity, baseCps, category, ability, extras = {}) {
  const stats = RARITY_STATS[rarity];
  const dogBonus = category === 'dog' ? 1.5 : 1;
  return {
    id, name, emoji, rarity, baseCps, category,
    attack: Math.round(stats.attack * dogBonus),
    hp: Math.round(stats.hp * (category === 'dog' ? 1.2 : 1)),
    ability: ability || 'none',
    ...extras,
  };
}

const BASE_CARDS = [
  // Common items & small pets
  makeCard('stone', 'Obyčejný kámen', '🪨', 'common', 1, 'item', 'none'),
  makeCard('key', 'Zrezlý klíč', '🔑', 'common', 1, 'item', 'none'),
  makeCard('mouse', 'Myš', '🐭', 'common', 1, 'rodent', 'bite'),
  makeCard('hamster', 'Křeček', '🐹', 'common', 1, 'rodent', 'none'),
  makeCard('fish', 'Zlatá rybka', '🐟', 'common', 1, 'fish', 'splash'),
  makeCard('frog', 'Žába', '🐸', 'common', 1, 'amphibian', 'poison'),
  makeCard('snail', 'Šnek', '🐌', 'common', 1, 'other', 'shield'),
  makeCard('worm', 'Červ', '🪱', 'common', 1, 'other', 'none'),
  makeCard('ant', 'Mravenec', '🐜', 'common', 1, 'other', 'bite'),
  makeCard('bee', 'Včela', '🐝', 'common', 1, 'other', 'poison'),
  makeCard('crab', 'Krab', '🦀', 'common', 1, 'fish', 'shield'),
  makeCard('jellyfish', 'Medúza', '🪼', 'common', 1, 'fish', 'stun'),

  // Common dogs
  makeCard('chihuahua', 'Čivava', '🐕', 'common', 2, 'dog', 'bite'),
  makeCard('pug', 'Mops', '🐶', 'common', 2, 'dog', 'shield'),
  makeCard('beagle', 'Beagle', '🐕', 'common', 2, 'dog', 'bite'),
  makeCard('terrier', 'Teriér', '🐶', 'common', 2, 'dog', 'rage'),
  makeCard('shiba', 'Shiba Inu', '🐕', 'common', 2, 'dog', 'howl'),

  // Rare pets
  makeCard('cat', 'Kočka', '🐈', 'rare', 3, 'cat', 'lifesteal'),
  makeCard('rabbit', 'Králík', '🐰', 'rare', 3, 'rodent', 'heal'),
  makeCard('parrot', 'Papoušek', '🦜', 'rare', 3, 'bird', 'stun'),
  makeCard('duck', 'Kachna', '🦆', 'rare', 3, 'bird', 'splash'),
  makeCard('turtle', 'Želva', '🐢', 'rare', 3, 'reptile', 'shield'),
  makeCard('sword', 'Stříbrný meč', '⚔️', 'rare', 3, 'item', 'bite'),
  makeCard('potion', 'Magický lektvar', '🧪', 'rare', 3, 'item', 'heal'),
  makeCard('fox', 'Liška', '🦊', 'rare', 3, 'other', 'lifesteal'),
  makeCard('owl', 'Sova', '🦉', 'rare', 3, 'bird', 'stun'),
  makeCard('octopus', 'Chobotnice', '🐙', 'rare', 3, 'fish', 'poison'),

  // Rare dogs
  makeCard('collie', 'Border Kolie', '🐕‍🦺', 'rare', 6, 'dog', 'howl'),
  makeCard('retriever', 'Zlatý retrívr', '🦮', 'rare', 6, 'dog', 'heal'),
  makeCard('corgi', 'Pembroke Corgi', '🐕', 'rare', 6, 'dog', 'bite'),
  makeCard('dachshund', 'Jezevčík', '🐶', 'rare', 6, 'dog', 'rage'),
  makeCard('spaniel', 'Kokršpaněl', '🐶', 'rare', 6, 'dog', 'lifesteal'),

  // Epic
  makeCard('panda', 'Panda', '🐼', 'epic', 8, 'other', 'shield'),
  makeCard('tiger', 'Tygr', '🐯', 'epic', 8, 'cat', 'rage'),
  makeCard('bear', 'Medvěd', '🐻', 'epic', 8, 'other', 'bite'),
  makeCard('eagle', 'Orel', '🦅', 'epic', 8, 'bird', 'splash'),
  makeCard('snake', 'Had', '🐍', 'epic', 8, 'reptile', 'poison'),
  makeCard('dragon', 'Zlatý drak', '🐉', 'epic', 8, 'item', 'cosmic'),
  makeCard('blackhole', 'Černá díra', '🕳️', 'epic', 8, 'item', 'cosmic'),
  makeCard('wolf', 'Vlk', '🐺', 'epic', 8, 'other', 'howl'),
  makeCard('whale', 'Velryba', '🐋', 'epic', 8, 'fish', 'splash'),
  makeCard('gorilla', 'Gorila', '🦍', 'epic', 8, 'other', 'rage'),

  // Epic dogs
  makeCard('husky', 'Sibiřský husky', '🐺', 'epic', 16, 'dog', 'howl'),
  makeCard('shepherd', 'Německý ovčák', '🐕‍🦺', 'epic', 16, 'dog', 'shield'),
  makeCard('poodle', 'Pudl', '🐩', 'epic', 16, 'dog', 'lifesteal'),
  makeCard('dalmatian', 'Dalmatin', '🐕', 'epic', 16, 'dog', 'splash'),
  makeCard('akita', 'Akita Inu', '🐶', 'epic', 16, 'dog', 'rage'),
  makeCard('mastiff', 'Mastif', '🐕', 'epic', 16, 'dog', 'bite'),

  // Legendary non-dogs
  makeCard('phoenix', 'Fénix', '🔥', 'legendary', 20, 'bird', 'heal'),
  makeCard('unicorn', 'Jednorožec', '🦄', 'legendary', 20, 'other', 'cosmic'),
  makeCard('kraken', 'Kraken', '🦑', 'legendary', 20, 'fish', 'poison'),
  makeCard('griffin', 'Gryf', '🦅', 'legendary', 20, 'bird', 'splash'),

  // Best card
  makeCard('havanese', 'Havanský psík', '🐶', 'legendary', 50, 'dog', 'cosmic', { isBest: true, attack: 72, hp: 150 }),
];

const LEVEL_MULTIPLIER = 1.5;
const DB_KEY = 'ccu_global_v1';
const SESSION_KEY = 'ccu_session';

function getCombatStats(card, level) {
  level = level || 1;
  const mult = Math.pow(LEVEL_MULTIPLIER, level - 1);
  return {
    attack: Math.round(card.attack * mult),
    hp: Math.round(card.hp * mult),
    ability: card.ability,
    abilityInfo: ABILITIES[card.ability] || ABILITIES.none,
  };
}

function getCardCps(card, level) {
  if (!level) return 0;
  return card.baseCps * Math.pow(LEVEL_MULTIPLIER, level - 1);
}

/* ── Shop — themes & kosmetika ── */
const SHOP_THEMES = {
  default: { name: 'Klasická', emoji: '🌙', vars: {} },
  ocean:   { name: 'Oceán', emoji: '🌊', vars: { '--bg-dark': '#0a1628', '--bg-card': '#0d2137', '--bg-elevated': '#1a3a5c', '--accent': '#00bcd4', '--gold': '#4dd0e1' } },
  sunset:  { name: 'Západ slunce', emoji: '🌅', vars: { '--bg-dark': '#1a0a0a', '--bg-card': '#2d1515', '--bg-elevated': '#4a2020', '--accent': '#ff6b35', '--gold': '#ffb347' } },
  neon:    { name: 'Neon', emoji: '💜', vars: { '--bg-dark': '#0d0221', '--bg-card': '#150734', '--bg-elevated': '#240046', '--accent': '#e040fb', '--gold': '#00e5ff' } },
  forest:  { name: 'Les', emoji: '🌲', vars: { '--bg-dark': '#0a1a0f', '--bg-card': '#142818', '--bg-elevated': '#1e3d24', '--accent': '#66bb6a', '--gold': '#aed581' } },
  gold:    { name: 'Zlatá', emoji: '👑', vars: { '--bg-dark': '#1a1508', '--bg-card': '#2d2410', '--bg-elevated': '#3d3218', '--accent': '#ffc107', '--gold': '#ffeb3b' } },
  cosmic:  { name: 'Kosmická', emoji: '🌌', vars: { '--bg-dark': '#0b0b1a', '--bg-card': '#12122b', '--bg-elevated': '#1a1a40', '--accent': '#7c4dff', '--gold': '#b388ff' } },
};

const SHOP_ITEMS = [
  { id: 'theme_ocean',  type: 'theme', themeId: 'ocean',  name: 'Téma Oceán',       emoji: '🌊', cost: 400,  desc: 'Modrý oceánský vzhled celé hry.' },
  { id: 'theme_sunset', type: 'theme', themeId: 'sunset', name: 'Téma Západ slunce', emoji: '🌅', cost: 400,  desc: 'Teplé oranžovo-červené barvy.' },
  { id: 'theme_neon',   type: 'theme', themeId: 'neon',   name: 'Téma Neon',          emoji: '💜', cost: 600,  desc: 'Fialovo-cyberpunkové téma.' },
  { id: 'theme_forest', type: 'theme', themeId: 'forest', name: 'Téma Les',           emoji: '🌲', cost: 450,  desc: 'Zelený přírodní vzhled.' },
  { id: 'theme_gold',   type: 'theme', themeId: 'gold',   name: 'Téma Zlatá',         emoji: '👑', cost: 800,  desc: 'Luxusní zlatý vzhled.' },
  { id: 'theme_cosmic', type: 'theme', themeId: 'cosmic', name: 'Téma Kosmos',        emoji: '🌌', cost: 1000, desc: 'Hvězdná galaxie — nejlepší theme!' },
  { id: 'boost_cps',    type: 'boost', name: 'CPS Boost +1',       emoji: '⚡', cost: 300,  desc: 'Trvalé +1 CPS ke všem kartám (stackuje se).', boostCps: 1 },
  { id: 'lucky_pack',   type: 'item',  name: 'Štěstí na 1 balíček', emoji: '🍀', cost: 150, desc: 'Příští balíček má lepší šance na rare+.' },
];
