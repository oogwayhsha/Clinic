import { auth, db } from "../firebase/firebase.js";
import { signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { ref, get, onValue } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

const loginForm = document.getElementById("loginForm");

const roleField = document.getElementById("loginRole");
const emailField = document.getElementById("loginEmail");
const passwordField = document.getElementById("loginPassword");

const roleError = document.getElementById("loginRoleError");
const emailError = document.getElementById("loginEmailError");
const passwordError = document.getElementById("loginPasswordError");
const loginMessage = document.getElementById("loginMessage");

// Admin accounts are NOT registrable. Create them manually in
// Firebase Console > Authentication > Add user, then list the email here.
const ADMIN_EMAILS = ["admin@nufv-cares.edu.ph"]; // <-- change to your real admin email

// ==========================================
// HELPERS
// ==========================================
function setError(field, errorEl, message) {
  field.classList.add("error-border");
  field.closest(".input-wrapper")?.classList.add("has-error");
  if (errorEl) errorEl.textContent = message;
}

function clearError(field, errorEl) {
  field.classList.remove("error-border");
  field.closest(".input-wrapper")?.classList.remove("has-error");
  if (errorEl) errorEl.textContent = "";
}

function clearAll() {
  clearError(roleField, roleError);
  clearError(emailField, emailError);
  clearError(passwordField, passwordError);
  loginMessage.textContent = "";
  loginMessage.className = "";
}

function showLoginMessage(message) {
  loginMessage.textContent = message;
  loginMessage.className = "login-error";
}

// Remove red state as soon as the user edits a field
roleField.addEventListener("change", () => {
  clearError(roleField, roleError);
  loginMessage.textContent = "";
});

emailField.addEventListener("input", () => {
  clearError(emailField, emailError);
  // wrong-credential errors also paint the password red, so clear both
  clearError(passwordField, passwordError);
  loginMessage.textContent = "";
});

passwordField.addEventListener("input", () => {
  clearError(passwordField, passwordError);
  clearError(emailField, emailError);
  loginMessage.textContent = "";
});

// ==========================================
// LOGIN SUBMIT
// ==========================================
loginForm.addEventListener("submit", async function (event) {
  event.preventDefault();

  const role = roleField.value;
  const email = emailField.value.trim();
  const password = passwordField.value;

  clearAll();

  let valid = true;

  // ACCOUNT TYPE
  if (role === "") {
    setError(roleField, roleError, "Please select an account type.");
    valid = false;
  }

  // EMAIL
  if (email === "") {
    setError(emailField, emailError, "Email is required.");
    valid = false;
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setError(emailField, emailError, "Enter a valid email address.");
    valid = false;
  }

  // PASSWORD
  if (password === "") {
    setError(passwordField, passwordError, "Password is required.");
    valid = false;
  }

  if (!valid) return;

  // ==========================================
  // FIREBASE LOGIN
  // ==========================================
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const isAdminAccount = ADMIN_EMAILS.includes(userCredential.user.email.toLowerCase());

    // Selected role must match the account type
    if ((role === "admin") !== isAdminAccount) {
      await signOut(auth);
      setError(roleField, roleError, "This account is not a " + role + " account.");
      return;
    }

    // Student / Employee: the account must exist in the matching folder
    if (role !== "admin") {
      const folder = role === "student" ? "students" : "employees";
      const snap = await get(ref(db, `${folder}/${userCredential.user.uid}`));
      if (!snap.exists()) {
        await signOut(auth);
        setError(roleField, roleError, "This account is not a " + role + " account.");
        return;
      }
    }

    console.log("Logged in UID:", userCredential.user.uid);
  } catch (error) {
    console.error(error);

    switch (error.code) {
      case "PERMISSION_DENIED":
        showLoginMessage("Access denied. Your account has no profile on record.");
        break;

      case "auth/invalid-email":
        setError(emailField, emailError, "Enter a valid email address.");
        break;

      case "auth/user-not-found":
        setError(emailField, emailError, "No account found with this email.");
        break;

      case "auth/wrong-password":
        setError(passwordField, passwordError, "Incorrect password.");
        break;

      case "auth/too-many-requests":
        showLoginMessage("Too many attempts. Please try again later.");
        break;

      case "auth/network-request-failed":
        showLoginMessage("Network error. Check your connection.");
        break;

      case "auth/invalid-credential":
      default:
        // Firebase doesn't say whether the email or password was wrong
        setError(emailField, null, "");
        setError(passwordField, null, "");
        showLoginMessage("Invalid email or password.");
        break;
    }
    return;
  }

  alert("Login Successful!");

  const destinations = {
    student: "../dashboard/dashboard.html",
    employee: "../dashboard/dashboard.html",
    admin: "../admin/admin.html" // adjust to your admin page path
  };
  window.location.href = destinations[role];
});

// ==========================================
// SHOW / HIDE PASSWORD
// ==========================================
const toggleLoginPassword = document.getElementById("toggleLoginPassword");

toggleLoginPassword.addEventListener("click", function () {
  if (passwordField.type === "password") {
    passwordField.type = "text";
    this.classList.remove("fa-eye");
    this.classList.add("fa-eye-slash");
  } else {
    passwordField.type = "password";
    this.classList.remove("fa-eye-slash");
    this.classList.add("fa-eye");
  }
});

// ==========================================
// RFID CARD PROCESSOR & DIRECT PHONE SCANNER
// ==========================================
const rfidUIDEl = document.getElementById("rfidUID");
const rfidStatusEl = document.getElementById("rfidStatus");
const rfidCardContainer = document.querySelector(".rfid-login");
let lastHandledTapTime = 0;

async function processRfidCard(cardUid) {
  const cleanUid = String(cardUid).trim().replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  console.log("Processing RFID Card:", cleanUid);

  if (rfidUIDEl) rfidUIDEl.textContent = cleanUid;
  if (rfidStatusEl) {
    rfidStatusEl.textContent = `Verifying card ${cleanUid}...`;
    rfidStatusEl.style.color = "#ffd41d";
  }

  try {
    const lookupSnap = await get(ref(db, `rfid_lookup/${cleanUid}`));

    if (!lookupSnap.exists()) {
      if (rfidStatusEl) {
        rfidStatusEl.textContent = `Card ${cleanUid} not registered.`;
        rfidStatusEl.style.color = "#ef4444";
      }
      alert(`Card ${cleanUid} is not registered yet.\n\nPlease register your account first and scan this card during registration.`);
      return;
    }

    const record = lookupSnap.val();
    console.log("Matched RFID user record:", record);

    if (rfidStatusEl) {
      rfidStatusEl.textContent = `Card verified! Logging in as ${record.name || record.email}...`;
      rfidStatusEl.style.color = "#10b981";
    }

    // Automatically set the role on form
    if (roleField && record.role) {
      roleField.value = record.role;
      clearError(roleField, roleError);
    }
    // Auto fill the email
    if (emailField && record.email) {
      emailField.value = record.email;
      clearError(emailField, emailError);
    }

    // If an authentication passKey or password was saved during card registration:
    if (record.email && record.authKey) {
      const userCred = await signInWithEmailAndPassword(auth, record.email, record.authKey);
      console.log("RFID Login successful:", userCred.user.uid);

      const destinations = {
        student: "../dashboard/dashboard.html",
        employee: "../dashboard/dashboard.html",
        admin: "../admin/admin.html"
      };

      setTimeout(() => {
        window.location.href = destinations[record.role] || "../dashboard/dashboard.html";
      }, 700);
    } else {
      // If no password stored, focus password field so user can enter password
      if (passwordField) {
        passwordField.focus();
        if (rfidStatusEl) {
          rfidStatusEl.textContent = `Welcome ${record.name || record.email}! Enter your password to continue.`;
          rfidStatusEl.style.color = "#ffd41d";
        }
      }
    }
  } catch (err) {
    console.error("RFID login error:", err);
    if (rfidStatusEl) {
      rfidStatusEl.textContent = "RFID Login: " + (err.message || "Failed to authenticate");
      rfidStatusEl.style.color = "#ef4444";
    }
    if (err.code === "auth/unauthorized-domain") {
      alert("Firebase Error: oogwayhsha.github.io is not an authorized domain.\n\nPlease add oogwayhsha.github.io in Firebase Console > Authentication > Settings > Authorized Domains.");
    } else {
      alert("Login Error: " + err.message);
    }
  }
}

// 1. Direct Phone NFC Tap (When visiting login.html on a smartphone)
const scanNfcLoginBtn = document.getElementById("scanNfcLoginBtn");

async function activateNfcLogin() {
  if (!("NDEFReader" in window)) {
    if (/FBAN|FBAV|Instagram|Line/i.test(navigator.userAgent)) {
      alert("You are viewing this inside the Facebook/Messenger app.\n\nTo use NFC scanning, tap the 3 dots (⋮) in the top-right corner and select 'Open in Chrome'.");
    } else {
      alert("Web NFC is not available in this browser.\n\nPlease open this link directly in Google Chrome on an Android phone with NFC enabled.");
    }
    return;
  }

  try {
    const ndef = new NDEFReader();
    await ndef.scan();

    if (scanNfcLoginBtn) {
      scanNfcLoginBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Scanner Active`;
      scanNfcLoginBtn.style.background = "#10b981";
      scanNfcLoginBtn.style.color = "#ffffff";
    }

    if (rfidStatusEl) {
      rfidStatusEl.textContent = "Hold your student/employee ID against the back of this phone...";
      rfidStatusEl.style.color = "#10b981";
    }

    ndef.onreading = (event) => {
      const rawSerial = event.serialNumber;
      if (!rawSerial) return;
      const cleanUid = rawSerial.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

      if (scanNfcLoginBtn) {
        scanNfcLoginBtn.innerHTML = `<i class="fa-solid fa-check"></i> Scanned!`;
      }

      processRfidCard(cleanUid);
    };

    ndef.onreadingerror = () => {
      if (rfidStatusEl) {
        rfidStatusEl.textContent = "Could not read card. Hold it steady against back of phone.";
        rfidStatusEl.style.color = "#ef4444";
      }
    };
  } catch (err) {
    console.error("Direct NFC scan activation error:", err);
    alert("NFC Scanner Error: " + err.message);
  }
}

if (scanNfcLoginBtn) {
  scanNfcLoginBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    activateNfcLogin();
  });
}

if (rfidCardContainer) {
  rfidCardContainer.style.cursor = "pointer";
  rfidCardContainer.addEventListener("click", () => {
    activateNfcLogin();
  });
}

// 2. Realtime Broadcast Listener (When login page is on PC and phone is used as scanner)
onValue(ref(db, "rfid_tap"), async (snapshot) => {
  const tap = snapshot.val();
  if (!tap || !tap.cardUid || !tap.timestamp) return;

  // Ignore tap if already handled or older than 25 seconds
  if (tap.timestamp <= lastHandledTapTime || Date.now() - tap.timestamp > 25000) {
    return;
  }
  lastHandledTapTime = tap.timestamp;

  processRfidCard(tap.cardUid);
});