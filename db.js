'use strict';

/**
 * Databázová vrstva — Firebase (online) nebo localStorage (offline fallback)
 */
const DB = (() => {
  let firebaseReady = false;
  let auth = null;
  let firestore = null;
  let currentUid = null;
  let userListener = null;

  let globalCache = { globalCards: [], updateVersion: 0 };

  function usernameToEmail(username) {
    return username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '') + '@ccu.game';
  }

  function defaultProfile(username) {
    return {
      username,
      rank: username === OWNER_USERNAME ? 'owner' : 'player',
      coins: 50,
      owned: {},
      customCards: [],
      friends: [],
      incomingRequests: [],
      outgoingRequests: [],
      duelInvites: [],
      wins: 0,
      losses: 0,
      lastSeenUpdate: 0,
      shopOwned: { themes: ['default'] },
      activeTheme: 'default',
    };
  }

  /* ── localStorage fallback ── */
  function loadLocalDB() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      const db = raw ? JSON.parse(raw) : { users: {} };
      if (!db.globalCards) db.globalCards = [];
      if (typeof db.updateVersion !== 'number') db.updateVersion = 0;
      return db;
    } catch (_) {
      return { users: {}, globalCards: [], updateVersion: 0 };
    }
  }

  function saveLocalDB(db) {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  }

  function getLocalUser(username) {
    return loadLocalDB().users[username] || null;
  }

  function saveLocalUser(username, data) {
    const db = loadLocalDB();
    db.users[username] = data;
    saveLocalDB(db);
  }

  /* ── Firebase ── */
  async function initFirebase() {
    if (!FIREBASE_ENABLED || typeof firebase === 'undefined') return false;
    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      auth = firebase.auth();
      firestore = firebase.firestore();
      firebaseReady = true;
      await refreshGlobalFromCloud();
      return true;
    } catch (e) {
      console.warn('Firebase init failed:', e);
      firebaseReady = false;
      return false;
    }
  }

  async function refreshGlobalFromCloud() {
    if (!firebaseReady) {
      const db = loadLocalDB();
      globalCache = { globalCards: db.globalCards || [], updateVersion: db.updateVersion || 0 };
      return globalCache;
    }
    const snap = await firestore.collection('game').doc('global').get();
    if (snap.exists) {
      const d = snap.data();
      globalCache = {
        globalCards: d.globalCards || [],
        updateVersion: d.updateVersion || 0,
      };
    }
    return globalCache;
  }

  async function saveGlobalToCloud(cards, version) {
    globalCache = { globalCards: cards, updateVersion: version };
    if (firebaseReady) {
      await firestore.collection('game').doc('global').set(globalCache, { merge: true });
    } else {
      const db = loadLocalDB();
      db.globalCards = cards;
      db.updateVersion = version;
      saveLocalDB(db);
    }
  }

  async function fetchUserDoc(uid) {
    const snap = await firestore.collection('users').doc(uid).get();
    return snap.exists ? snap.data() : null;
  }

  async function saveUserDoc(uid, data) {
    const { password, ...safe } = data;
    await firestore.collection('users').doc(uid).set(safe, { merge: true });
  }

  async function registerUsername(username, uid) {
    await firestore.collection('usernames').doc(username.toLowerCase()).set({
      uid,
      username,
    });
  }

  async function lookupUsername(username) {
    const snap = await firestore.collection('usernames').doc(username.toLowerCase()).get();
    return snap.exists ? snap.data() : null;
  }

  return {
    isOnline() {
      return firebaseReady;
    },

    async init() {
      const ok = await initFirebase();
      if (!ok) {
        const db = loadLocalDB();
        globalCache = { globalCards: db.globalCards || [], updateVersion: db.updateVersion || 0 };
      }
      return ok;
    },

    getGlobalCache() {
      return globalCache;
    },

    async refreshGlobal() {
      return refreshGlobalFromCloud();
    },

    async saveGlobal(cards, version) {
      return saveGlobalToCloud(cards, version);
    },

    onAuthChanged(callback) {
      if (!firebaseReady) return;
      let appReady = false;
      auth.onAuthStateChanged(async (fbUser) => {
        if (userListener) { userListener(); userListener = null; }
        if (!fbUser) {
          currentUid = null;
          appReady = false;
          callback(null);
          return;
        }
        currentUid = fbUser.uid;
        let profile = await fetchUserDoc(fbUser.uid);
        if (!profile) {
          profile = defaultProfile(fbUser.displayName || 'Hráč');
          await saveUserDoc(fbUser.uid, profile);
        }
        if (profile.username === OWNER_USERNAME) profile.rank = 'owner';

        const emit = (data) => {
          if (data.username === OWNER_USERNAME) data.rank = 'owner';
          callback(data, appReady);
          appReady = true;
        };

        emit({ uid: fbUser.uid, ...profile });

        userListener = firestore.collection('users').doc(fbUser.uid)
          .onSnapshot((snap) => {
            if (snap.exists) emit({ uid: fbUser.uid, ...snap.data() });
          });
      });
    },

    async login(username, password) {
      username = username.trim();
      if (firebaseReady) {
        const email = usernameToEmail(username);
        const cred = await auth.signInWithEmailAndPassword(email, password);
        const profile = await fetchUserDoc(cred.user.uid);
        if (!profile) throw new Error('Profil nenalezen.');
        if (profile.username === OWNER_USERNAME) profile.rank = 'owner';
        sessionStorage.setItem(SESSION_KEY, profile.username);
        return { uid: cred.user.uid, ...profile };
      }

      const user = getLocalUser(username);
      if (!user) throw new Error('Uživatel neexistuje.');
      let h = 0;
      for (let i = 0; i < password.length; i++) h = ((h << 5) - h + password.charCodeAt(i)) | 0;
      if (user.password !== String(h)) throw new Error('Špatné heslo.');
      if (username === OWNER_USERNAME) user.rank = 'owner';
      sessionStorage.setItem(SESSION_KEY, username);
      return user;
    },

    async register(username, password) {
      username = username.trim();
      if (username.length < 3) throw new Error('Jméno musí mít alespoň 3 znaky.');
      if (password.length < 4) throw new Error('Heslo musí mít alespoň 4 znaky.');

      if (firebaseReady) {
        const existing = await lookupUsername(username);
        if (existing) throw new Error('Jméno je obsazené.');

        const email = usernameToEmail(username);
        const cred = await auth.createUserWithEmailAndPassword(email, password);
        await cred.user.updateProfile({ displayName: username });

        const profile = defaultProfile(username);
        await registerUsername(username, cred.user.uid);
        await saveUserDoc(cred.user.uid, profile);
        sessionStorage.setItem(SESSION_KEY, username);
        return { uid: cred.user.uid, ...profile };
      }

      const db = loadLocalDB();
      if (db.users[username]) throw new Error('Jméno je obsazené.');
      const user = defaultProfile(username);
      let h = 0;
      for (let i = 0; i < password.length; i++) h = ((h << 5) - h + password.charCodeAt(i)) | 0;
      user.password = String(h);
      db.users[username] = user;
      saveLocalDB(db);
      sessionStorage.setItem(SESSION_KEY, username);
      return user;
    },

    async logout() {
      sessionStorage.removeItem(SESSION_KEY);
      if (userListener) { userListener(); userListener = null; }
      currentUid = null;
      if (firebaseReady) await auth.signOut();
    },

    getSession() {
      return sessionStorage.getItem(SESSION_KEY);
    },

    async persistUser(user) {
      if (!user) return;
      if (firebaseReady && currentUid) {
        await saveUserDoc(currentUid, user);
      } else if (user.username) {
        saveLocalUser(user.username || DB.getSession(), user);
      }
    },

    async getUserByUsername(username) {
      if (firebaseReady) {
        const lookup = await lookupUsername(username);
        if (!lookup) return null;
        return fetchUserDoc(lookup.uid);
      }
      return getLocalUser(username);
    },

    async updateUserByUsername(username, data) {
      if (firebaseReady) {
        const lookup = await lookupUsername(username);
        if (!lookup) return;
        const { password, ...safe } = data;
        await firestore.collection('users').doc(lookup.uid).set(safe, { merge: true });
      } else {
        saveLocalUser(username, data);
      }
    },

    getUid() {
      return currentUid;
    },
  };
})();
