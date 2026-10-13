import { initializeApp } from
    "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth } from
    "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { getDatabase } from
    "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";
// ==========================================
// FIREBASE CONFIGURATION   
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyCIa8Bzk5S0oX7jJbAsZUURLwr1LyDLe4Q",
    authDomain: "nufv-clinic.firebaseapp.com",
    databaseURL: "https://nufv-clinic-default-rtdb.asia-southeast1.firebasedatabase.app/",
    projectId: "nufv-clinic",
    storageBucket: "nufv-clinic.firebasestorage.app",
    messagingSenderId: "799965622971",
    appId: "1:799965622971:web:7d3c7b16535b1304f02f9e",
    measurementId: "G-MYN6K7XGK4"
};
// ==========================================
// INITIALIZE FIREBASE
// ==========================================
const app = initializeApp(firebaseConfig);
// ==========================================
// INITIALIZE AUTHENTICATION
// ==========================================
const auth = getAuth(app);
// ==========================================
// INITIALIZE REALTIME DATABASE
// ==========================================
const db = getDatabase(app);
// ==========================================
// EXPORT
// ==========================================
export { app, auth, db };