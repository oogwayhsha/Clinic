import { auth, db } from "../firebase/firebase.js";
import { signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

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