import { auth, db } from "../firebase/firebase.js";
import { signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { ref, get, update, onValue } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";
import { ADMIN_UID } from "../shared/config.js";

const loginForm = document.getElementById("loginForm");

const roleField = document.getElementById("loginRole");
const emailField = document.getElementById("loginEmail");
const passwordField = document.getElementById("loginPassword");

const roleError = document.getElementById("loginRoleError");
const emailError = document.getElementById("loginEmailError");
const passwordError = document.getElementById("loginPasswordError");
const loginMessage = document.getElementById("loginMessage");

// Employee accounts are NOT registrable. Create them manually in
// Firebase Console > Authentication > Add user, then list the email here.
const EMPLOYEE_EMAILS = ["admin@nufv-cares.edu.ph"]; // <-- change to your real employee email(s)

// Employees go to the admin dashboard. Students keep their own.
const EMPLOYEE_PAGE = "../admin/admin.html";

const DESTINATIONS = {
  student: "../dashboard/dashboard.html",
  employee: EMPLOYEE_PAGE
};

const ROLE_NAMES = {
  student: "student",
  employee: "employee"
};

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
// ACCOUNT TYPE CHECK
// Returns null when the signed-in account matches the chosen role,
// otherwise a message (and the user is signed out again).
// ==========================================
async function checkRole(user, role) {
  const isEmployeeAccount =
    user.uid === ADMIN_UID ||
    EMPLOYEE_EMAILS.includes((user.email || "").toLowerCase());

  if ((role === "employee") !== isEmployeeAccount) {
    await signOut(auth);
    return "This account is not a" + (role === "employee" ? "n employee" : " student") + " account.";
  }

  // Students must also exist in the students folder
  if (role === "student") {
    const snap = await get(ref(db, `students/${user.uid}`));

    if (!snap.exists()) {
      await signOut(auth);
      return "This account is not a student account.";
    }
  }

  return null;
}

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

    const problem = await checkRole(userCredential.user, role);

    if (problem) {
      setError(roleField, roleError, problem);
      return;
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

  window.location.href = DESTINATIONS[role];
});

// ==========================================
// SHOW / HIDE PASSWORD
// ==========================================
function setupToggle(iconId, input) {
  const icon = document.getElementById(iconId);
  if (!icon || !input) return;

  icon.addEventListener("click", function () {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    this.classList.toggle("fa-eye", !show);
    this.classList.toggle("fa-eye-slash", show);
  });
}

setupToggle("toggleLoginPassword", passwordField);

// ==========================================
// RFID / NFC LOGIN
// A card tap only identifies the account. The owner must still type
// their password, so a lost or borrowed ID can't be used to log in.
// ==========================================
const rfidUIDEl = document.getElementById("rfidUID");
const rfidStatusEl = document.getElementById("rfidStatus");
const rfidCardContainer = document.querySelector(".rfid-login");
let lastHandledTapTime = 0;

const tapModal = document.getElementById("tapModal");
const tapForm = document.getElementById("tapForm");
const tapPassword = document.getElementById("tapPassword");
const tapUsername = document.getElementById("tapUsername");
const tapError = document.getElementById("tapError");
const tapSubmit = document.getElementById("tapSubmit");

const MAX_TAP_ATTEMPTS = 5;

let tapRecord = null;   // rfid_lookup entry waiting for the password
let tapCardUid = "";
let tapAttempts = 0;

setupToggle("toggleTapPassword", tapPassword);

function setRfidStatus(text, color) {
  if (!rfidStatusEl) return;
  rfidStatusEl.textContent = text;
  rfidStatusEl.style.color = color;
}

// juan.delacruz@gmail.com -> ju********@gmail.com
function maskEmail(email) {
  const [name, domain] = String(email || "").split("@");
  if (!domain) return "";
  return `${name.slice(0, 2)}${"*".repeat(Math.max(3, name.length - 2))}@${domain}`;
}

function openTapModal(record, cardUid) {
  tapRecord = record;
  tapCardUid = cardUid;
  tapAttempts = 0;

  document.getElementById("tapName").textContent = record.name || "Card holder";
  document.getElementById("tapEmail").textContent = maskEmail(record.email);
  document.getElementById("tapRole").textContent = record.role === "employee" ? "Employee" : "Student";

  // Lets password managers fill the right account
  tapUsername.value = record.email || "";

  tapPassword.value = "";
  tapPassword.type = "password";
  tapError.textContent = "";
  tapPassword.closest(".input-wrapper")?.classList.remove("has-error");
  tapSubmit.disabled = false;

  tapModal.hidden = false;
  setTimeout(() => tapPassword.focus(), 50);
}

function closeTapModal(message) {
  tapModal.hidden = true;
  tapRecord = null;
  tapPassword.value = "";

  setRfidStatus(message || "Tap your RFID card on the reader", message ? "#ef4444" : "");
  if (rfidUIDEl) rfidUIDEl.textContent = "Waiting...";
}

document.getElementById("tapCancel").addEventListener("click", () => closeTapModal());

document.getElementById("tapNotMe").addEventListener("click", () => {
  closeTapModal();
  emailField.focus();
});

tapModal.addEventListener("click", (event) => {
  if (event.target === tapModal) closeTapModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !tapModal.hidden) closeTapModal();
});

tapPassword.addEventListener("input", () => {
  tapError.textContent = "";
  tapPassword.closest(".input-wrapper")?.classList.remove("has-error");
});

tapForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const record = tapRecord;
  const password = tapPassword.value;

  if (!record) return;

  if (!password) {
    tapError.textContent = "Enter your password to confirm it's you.";
    tapPassword.closest(".input-wrapper")?.classList.add("has-error");
    return;
  }

  tapSubmit.disabled = true;

  try {
    const cred = await signInWithEmailAndPassword(auth, record.email, password);

    // The card must point at the account that just signed in
    if (record.uid && record.uid !== cred.user.uid) {
      await signOut(auth);
      closeTapModal("This card is linked to a different account. Please contact the clinic.");
      return;
    }

    const role = record.role === "employee" ? "employee" : "student";
    const problem = await checkRole(cred.user, role);

    if (problem) {
      closeTapModal(problem);
      return;
    }

    // Older registrations stored the password with the card: remove it
    if (record.authKey !== undefined) {
      await update(ref(db, `rfid_lookup/${tapCardUid}`), { authKey: null })
        .catch((err) => console.warn("Could not remove the old saved password:", err));
    }

    tapModal.hidden = true;
    setRfidStatus(`Welcome, ${record.name || "back"}! Logging you in...`, "#10b981");

    setTimeout(() => {
      window.location.href = DESTINATIONS[role];
    }, 600);

  } catch (err) {
    console.error("Card login error:", err);
    tapAttempts++;
    tapSubmit.disabled = false;

    if (err.code === "auth/too-many-requests" || tapAttempts >= MAX_TAP_ATTEMPTS) {
      closeTapModal("Too many attempts. Please log in with your email and password.");
      return;
    }

    if (err.code === "auth/network-request-failed") {
      tapError.textContent = "Network error. Check your connection.";
      return;
    }

    if (err.code === "auth/unauthorized-domain") {
      tapError.textContent = "This website isn't an authorized domain in Firebase Authentication settings.";
      return;
    }

    tapError.textContent = `Incorrect password. ${MAX_TAP_ATTEMPTS - tapAttempts} attempt${MAX_TAP_ATTEMPTS - tapAttempts === 1 ? "" : "s"} left.`;
    tapPassword.closest(".input-wrapper")?.classList.add("has-error");
    tapPassword.select();
  }
});

async function processRfidCard(cardUid) {
  const cleanUid = String(cardUid).trim().replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!cleanUid) return;

  if (rfidUIDEl) rfidUIDEl.textContent = cleanUid;
  setRfidStatus(`Checking card ${cleanUid}...`, "#ffd41d");

  try {
    const lookupSnap = await get(ref(db, `rfid_lookup/${cleanUid}`));

    if (!lookupSnap.exists()) {
      setRfidStatus(`Card ${cleanUid} is not registered.`, "#ef4444");
      alert(`Card ${cleanUid} is not registered yet.\n\nPlease register your account first and scan this card during registration.`);
      return;
    }

    const record = lookupSnap.val();

    if (!record.email) {
      setRfidStatus("This card has no account linked. Please contact the clinic.", "#ef4444");
      return;
    }

    setRfidStatus("Card recognized. Enter your password to continue.", "#10b981");
    openTapModal(record, cleanUid);

  } catch (err) {
    console.error("RFID lookup error:", err);
    setRfidStatus("RFID Login: " + (err.message || "Couldn't check the card"), "#ef4444");
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

    setRfidStatus("Hold your student/employee ID against the back of this phone...", "#10b981");

    ndef.onreading = (event) => {
      const rawSerial = event.serialNumber;
      if (!rawSerial || !tapModal.hidden) return;
      const cleanUid = rawSerial.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

      if (scanNfcLoginBtn) {
        scanNfcLoginBtn.innerHTML = `<i class="fa-solid fa-check"></i> Scanned!`;
      }

      processRfidCard(cleanUid);
    };

    ndef.onreadingerror = () => {
      setRfidStatus("Could not read card. Hold it steady against back of phone.", "#ef4444");
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

  // Ignore tap if already handled, older than 25 seconds, or a password prompt is open
  if (tap.timestamp <= lastHandledTapTime || Date.now() - tap.timestamp > 25000 || !tapModal.hidden) {
    return;
  }
  lastHandledTapTime = tap.timestamp;

  processRfidCard(tap.cardUid);
});

// ==========================================
// FORGOT PASSWORD
// Firebase sends the reset email, so nobody has to wait for an admin
// to do it for them.
// ==========================================
const resetModal = document.getElementById("resetModal");
const resetForm = document.getElementById("resetForm");
const resetEmail = document.getElementById("resetEmail");
const resetError = document.getElementById("resetError");
const resetMessage = document.getElementById("resetMessage");
const resetSubmit = document.getElementById("resetSubmit");

function setResetMessage(text, kind) {
  resetMessage.textContent = text;
  resetMessage.className = kind === "ok" ? "login-success" : "login-error";
}

function openResetModal() {
  // Carry over whatever they already typed, so it isn't asked twice
  resetEmail.value = emailField.value.trim();
  resetError.textContent = "";
  resetMessage.textContent = "";
  resetMessage.className = "";
  resetSubmit.disabled = false;
  resetModal.hidden = false;
  setTimeout(() => resetEmail.focus(), 50);
}

function closeResetModal() {
  resetModal.hidden = true;
}

document.getElementById("forgotPasswordBtn").addEventListener("click", openResetModal);
document.getElementById("resetCancel").addEventListener("click", closeResetModal);
document.getElementById("resetBack").addEventListener("click", closeResetModal);

resetModal.addEventListener("click", (event) => {
  if (event.target === resetModal) closeResetModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !resetModal.hidden) closeResetModal();
});

resetEmail.addEventListener("input", () => {
  resetError.textContent = "";
  resetEmail.closest(".input-wrapper")?.classList.remove("has-error");
});

resetForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = resetEmail.value.trim();

  resetError.textContent = "";
  resetMessage.textContent = "";
  resetMessage.className = "";

  if (email === "") {
    resetError.textContent = "Enter the email you log in with.";
    resetEmail.closest(".input-wrapper")?.classList.add("has-error");
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    resetError.textContent = "Enter a valid email address.";
    resetEmail.closest(".input-wrapper")?.classList.add("has-error");
    return;
  }

  resetSubmit.disabled = true;
  setResetMessage("Sending...", "ok");

  try {
    await sendPasswordResetEmail(auth, email);

    // Said the same way whether or not the account exists, so the page
    // can't be used to find out who has an account here.
    setResetMessage("If that email has an account, a reset link is on its way. Check your inbox and spam folder.", "ok");
  } catch (error) {
    console.error("Password reset error:", error);

    switch (error.code) {
      case "auth/invalid-email":
        resetError.textContent = "Enter a valid email address.";
        setResetMessage("", "");
        break;

      case "auth/too-many-requests":
        setResetMessage("Too many attempts. Please try again in a few minutes.", "error");
        break;

      case "auth/network-request-failed":
        setResetMessage("Network error. Check your connection and try again.", "error");
        break;

      case "auth/user-not-found":
        // Same wording as success, for the reason above
        setResetMessage("If that email has an account, a reset link is on its way. Check your inbox and spam folder.", "ok");
        break;

      default:
        setResetMessage("Could not send the reset email. Please try again.", "error");
        break;
    }
  } finally {
    resetSubmit.disabled = false;
  }
});