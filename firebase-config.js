'use strict';

/**
 * Firebase konfigurace — doplň údaje z Firebase Console:
 * https://console.firebase.google.com
 *
 * 1. Vytvoř projekt → Add app → Web
 * 2. Zkopíruj config sem
 * 3. Authentication → Sign-in → Email/Password (zapni)
 * 4. Firestore Database → Create database
 * 5. Rules (testování): allow read, write: if request.auth != null;
 * 6. Nasazení: Firebase Hosting, Netlify, Vercel nebo GitHub Pages
 */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyANqJHrFRp8dqyvclk_kPVy9rgF5bNoD6k",
  authDomain: "card-collector-unite.firebaseapp.com",
  projectId: "card-collector-unite",
  storageBucket: "card-collector-unite.firebasestorage.app",
  messagingSenderId: "460580307427",
  appId: "1:460580307427:web:1307df4969ad3a39c9e0d6",
  measurementId: "G-B7BLYNERV8"
};

const FIREBASE_ENABLED = FIREBASE_CONFIG.apiKey && !FIREBASE_CONFIG.apiKey.includes('YOUR_');
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);