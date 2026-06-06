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
      const raw = localStorage.getItem('ccu_local_db');
      const db = raw ? JSON.parse(raw) : { users: {} };
      if (!db.globalCards) db.globalCards = [];
      if (typeof db.updateVersion !== 'number') db.updateVersion = 0;
      return db;
    } catch(e) {
      return { users: {}, globalCards: [], updateVersion: 0 };
    }
  }

  function saveLocalDB(db) {
    try {
      localStorage.setItem('ccu_local_db', JSON.stringify(db));
    } catch(e) {}
  }

  function getLocalUser(username) {
    const db = loadLocalDB();
    return db.users[username] || null;
  }

  function saveLocalUser(username, data) {
    const db = loadLocalDB();
    db.users[username] = data;
    saveLocalDB(db);
  }

  /* ── Firestore Helpers ── */
  async function fetchUserDoc(uid) {
    if (!firebaseReady) return null;
    try {
      const snap = await firestore.collection('users').doc(uid).get();
      if (snap.exists) return snap.data();
    } catch(e) {
      console.error("Chyba při načítání dokumentu:", e);
    }
    return null;
  }

  async function saveUserDoc(uid, data) {
    if (!firebaseReady) return;
    try {
      await firestore.collection('users').doc(uid).set(data, { merge: true });
    } catch(e) {
      console.error("Chyba při ukládání do Firestore:", e);
    }
  }

  async function lookupUsername(username) {
    if (!firebaseReady) return null;
    try {
      const snap = await firestore.collection('usernames').doc(username.trim().toLowerCase()).get();
      if (snap.exists) return snap.data();
    } catch(e) {}
    return null;
  }

  return {
    async init() {
      if (!FIREBASE_ENABLED) {
        firebaseReady = false;
        return;
      }
      try {
        // Inicializace Firebase skrze Globální Compat SDK objekt
        const app = firebase.initializeApp(FIREBASE_CONFIG);
        auth = firebase.auth();
        firestore = firebase.firestore();
        firebaseReady = true;

        // Načtení globálních karet z Firestore
        try {
          const configSnap = await firestore.collection('global').doc('config').get();
          if (configSnap.exists) {
            const d = configSnap.data();
            globalCache.globalCards = d.globalCards || [];
            globalCache.updateVersion = d.updateVersion || 0;
          }
        } catch(e) {
          console.warn("Nepodařilo se stáhnout globální karty z Firebase, používám lokální data.");
        }

      } catch(e) {
        console.error("Firebase inicializace selhala:", e);
        firebaseReady = false;
      }
    },

    isOnline() {
      return firebaseReady;
    },

    getGlobalCache() {
      return globalCache;
    },

    onAuthChanged(callback) {
      if (!firebaseReady) return;
      if (userListener) userListener();

      auth.onAuthStateChanged(async (user) => {
        if (user) {
          currentUid = user.uid;
          const cloudProfile = await fetchUserDoc(user.uid);
          if (cloudProfile) {
            callback(cloudProfile, false);
          } else {
            const sessionName = sessionStorage.getItem('ccu_session_user') || 'Hráč';
            const fresh = defaultProfile(sessionName);
            await saveUserDoc(user.uid, fresh);
            callback(fresh, false);
          }
        } else {
          currentUid = null;
          callback(null, false);
        }
      });
    },

    async login(username, password) {
      const email = usernameToEmail(username);
      if (firebaseReady) {
        const cred = await auth.signInWithEmailAndPassword(email, password);
        currentUid = cred.user.uid;
        sessionStorage.setItem('ccu_session_user', username);
        const profile = await fetchUserDoc(cred.user.uid);
        return profile;
      } else {
        const local = getLocalUser(username);
        if (!local) throw new Error('Uživatel neexistuje v offline režimu');
        // Jednoduchý hash pro offline
        let h = 0;
        for (let i = 0; i < password.length; i++) h = ((h << 5) - h + password.charCodeAt(i)) | 0;
        if (local.password !== String(h)) throw new Error('Nesprávné heslo');
        sessionStorage.setItem('ccu_session_user', username);
        return local;
      }
    },

    async register(username, password) {
      const email = usernameToEmail(username);
      const cleanName = username.trim();
      
      if (firebaseReady) {
        const exists = await lookupUsername(cleanName);
        if (exists) throw new Error('Uživatelské jméno je již obsazené');

        const cred = await auth.createUserWithEmailAndPassword(email, password);
        currentUid = cred.user.uid;
        
        const newUser = defaultProfile(cleanName);
        await saveUserDoc(cred.user.uid, newUser);
        await firestore.collection('usernames').doc(cleanName.toLowerCase()).set({ uid: cred.user.uid, username: cleanName });
        
        sessionStorage.setItem('ccu_session_user', cleanName);
        return newUser;
      } else {
        const db = loadLocalDB();
        if (db.users[cleanName]) throw new Error('Uživatelské jméno je již obsazené');
        
        const user = defaultProfile(cleanName);
        let h = 0;
        for (let i = 0; i < password.length; i++) h = ((h << 5) - h + password.charCodeAt(i)) | 0;
        user.password = String(h);
        db.users[cleanName] = user;
        saveLocalDB(db);
        sessionStorage.setItem('ccu_session_user', cleanName);
        return user;
      }
    },

    async logout() {
      sessionStorage.removeItem('ccu_session_user');
      if (userListener) { userListener(); userListener = null; }
      currentUid = null;
      if (firebaseReady) await auth.signOut();
    },

    getSession() {
      return sessionStorage.getItem('ccu_session_user');
    },

    async persistUser(user) {
      if (!user) return;
      if (firebaseReady && currentUid) {
        await saveUserDoc(currentUid, user);
      } else if (user.username) {
        saveLocalUser(user.username, user);
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
        await firestore.collection('users').doc(lookup.uid).set(data, { merge: true });
      } else {
        saveLocalUser(username, data);
      }
    }
  };
})();