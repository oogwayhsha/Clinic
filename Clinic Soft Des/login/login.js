import { auth } from "../firebase/firebase.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

const loginForm = document.getElementById("loginForm");

loginForm.addEventListener("submit", async function(event) {
  event.preventDefault();

  // ==========================================
  // GET VALUES
  // ==========================================
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  // ==========================================
  // CLEAR MESSAGES
  // ==========================================
  document.getElementById("loginEmailError").textContent = "";
  document.getElementById("loginPasswordError").textContent = "";
  document.getElementById("loginMessage").textContent = "";
  document.getElementById("loginMessage").className = "";

  let valid = true;

  // ==========================================
  // EMAIL VALIDATION
  // ==========================================
  if (email === "") {
    document.getElementById("loginEmailError").textContent = "Email is required.";
    valid = false;
  }

  // ==========================================
  // PASSWORD VALIDATION
  // ==========================================
  if (password === "") {
    document.getElementById("loginPasswordError").textContent = "Password is required.";
    valid = false;
  }

  // ==========================================
  // FIREBASE LOGIN
  // ==========================================
  if (valid) {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      console.log("Logged in UID:", user.uid);
      alert("Login Successful!");
      window.location.href = "../dashboard/dashboard.html";
    } catch (error) {
      console.error(error);
      document.getElementById("loginMessage").textContent = "Invalid email or password.";
      document.getElementById("loginMessage").className = "login-error";
    }
  }
});

// ==========================================
// SHOW / HIDE PASSWORD
// ==========================================
const toggleLoginPassword = document.getElementById("toggleLoginPassword");
const loginPasswordField = document.getElementById("loginPassword");

toggleLoginPassword.addEventListener("click", function() {
  if (loginPasswordField.type === "password") {
    loginPasswordField.type = "text";
    this.classList.remove("fa-eye");
    this.classList.add("fa-eye-slash");
  } else {
    loginPasswordField.type = "password";
    this.classList.remove("fa-eye-slash");
    this.classList.add("fa-eye");
  }
});

