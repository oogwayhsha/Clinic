// ==========================================
// FIREBASE IMPORTS
// ==========================================
import { auth, db } from "../firebase/firebase.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { ref, set } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

let currentRole = "student";

// Set to true if only NU emails should be accepted
// (students: @students.nu-fairview.edu.ph, employees: @nu-fairview.edu.ph)
const REQUIRE_NU_EMAIL = false;

const registerForm = document.getElementById("registerForm");
const registerBtn = document.getElementById("registerBtn");
const regMessage = document.getElementById("regMessage");

// Prevents double submissions (e.g. Enter key + button click)
let isSubmitting = false;

// ==========================================
// ERROR HELPERS
// ==========================================

// Marks a field red and shows its message (error span is found automatically)
function setError(inputId, message) {
  const input = document.getElementById(inputId);
  if (!input) return;

  input.classList.add("error-border");

  const group = input.closest(".form-group");
  const errorEl = group ? group.querySelector(".error") : null;
  if (errorEl) errorEl.textContent = message;
}

// Clears red state + message for one field
function clearFieldError(input) {
  input.classList.remove("error-border");

  const group = input.closest(".form-group");
  const errorEl = group ? group.querySelector(".error") : null;
  if (errorEl) errorEl.textContent = "";
}

// Clears every error on the form
function clearErrors() {
  document.querySelectorAll("#registerForm input, #registerForm select").forEach((el) => {
    el.classList.remove("error-border");
  });

  document.querySelectorAll(".error").forEach((el) => (el.textContent = ""));

  if (regMessage) {
    regMessage.textContent = "";
    regMessage.className = "";
  }
}

function showGlobalError(message) {
  regMessage.textContent = message;
  regMessage.className = "reg-error";
}

// Remove the red state as soon as the user edits a field
document.querySelectorAll("#registerForm input, #registerForm select").forEach((field) => {
  ["input", "change"].forEach((evt) => {
    field.addEventListener(evt, () => {
      clearFieldError(field);
      if (regMessage) {
        regMessage.textContent = "";
        regMessage.className = "";
      }

      // Typing in password also clears a "do not match" error on confirm
      if (field.id === "regPassword") {
        clearFieldError(document.getElementById("regConfirmPassword"));
      }
    });
  });
});

// ==========================================
// KEY-SENSITIVE INPUT RULES
// ==========================================
// block: characters that are removed as the user types or pastes
// max:   maximum length
// upper: force uppercase
// (Employee ID has its own formatter further below)
const INPUT_RULES = {
  // Letters (incl. accented), spaces, . ' -
  regName:        { block: /[^A-Za-zÀ-ÿ.'\- ]/g,            max: 60 },

  // Digits and hyphen only (e.g. 2022-1234567) -> 4 + hyphen + 7 = 12 chars
  studentId:      { block: /[^0-9-]/g,                       max: 12 },

  // Letters, spaces, & . - ( )
  studentProgram: { block: /[^A-Za-z&.\-() ]/g,             max: 40 },

  // Letters, digits, spaces, & . , - ( ) /
  employeeDept:   { block: /[^A-Za-z0-9&.,\-()\/ ]/g,       max: 60 },

  // No spaces in email or passwords
  regEmail:           { block: /\s/g,                        max: 100 },
  regPassword:        { block: /\s/g,                        max: 64 },
  regConfirmPassword: { block: /\s/g,                        max: 64 }
};

function sanitize(value, rule) {
  let out = value.replace(rule.block, "");
  if (rule.upper) out = out.toUpperCase();
  // no leading space, no double spaces
  out = out.replace(/^ +/, "").replace(/ {2,}/g, " ");
  return out;
}

Object.entries(INPUT_RULES).forEach(([id, rule]) => {
  const el = document.getElementById(id);
  if (!el) return;

  el.maxLength = rule.max;

  el.addEventListener("input", () => {
    const original = el.value;

    // Keep the cursor where the user was typing
    let pos = null;
    try { pos = el.selectionStart; } catch (e) {}

    const cleaned = sanitize(original, rule);
    if (cleaned === original) return;

    el.value = cleaned;

    if (pos !== null) {
      const newPos = sanitize(original.slice(0, pos), rule).length;
      try { el.setSelectionRange(newPos, newPos); } catch (e) {}
    }
  });
});

// ==========================================
// EMPLOYEE ID FORMATTER  (AAA-0000-000)
// ==========================================
// 3 letters, then 4 digits, then 3 digits. Hyphens are added automatically.
function formatEmployeeId(value) {
  const raw = value.toUpperCase().replace(/[^A-Z0-9]/g, "");

  // Part 1: up to 3 letters (digits are ignored here)
  const letters = (raw.match(/^[A-Z]{0,3}/) || [""])[0];

  // Parts 2 and 3: digits only, and only after 3 letters are entered
  const digits = letters.length === 3
    ? raw.slice(letters.length).replace(/[^0-9]/g, "").slice(0, 7)
    : "";

  let out = letters;
  if (digits.length > 0) out += "-" + digits.slice(0, 4);
  if (digits.length > 4) out += "-" + digits.slice(4, 7);
  return out;
}

const employeeIdInput = document.getElementById("employeeId");
if (employeeIdInput) {
  employeeIdInput.maxLength = 12;
  employeeIdInput.addEventListener("input", () => {
    employeeIdInput.value = formatEmployeeId(employeeIdInput.value);
  });
}

// ==========================================
// ROLE SWITCHER FUNCTION
// ==========================================
// Explicitly attach to window so inline onclick="switchRole(...)" can access it in ES modules
window.switchRole = function (role) {
  currentRole = role;

  const studentTab = document.getElementById("studentTab");
  const employeeTab = document.getElementById("employeeTab");
  const studentFields = document.getElementById("studentFields");
  const employeeFields = document.getElementById("employeeFields");
  const formRoleTitle = document.getElementById("formRoleTitle");
  const regEmail = document.getElementById("regEmail");

  // Clear previous errors (text and red borders) when switching tabs
  clearErrors();

  if (role === "student") {
    studentTab.classList.add("active");
    employeeTab.classList.remove("active");
    studentFields.style.display = "block";
    employeeFields.style.display = "none";
    formRoleTitle.textContent = "Student Registration";
    regEmail.placeholder = "username@students.nu-fairview.edu.ph";
  } else {
    employeeTab.classList.add("active");
    studentTab.classList.remove("active");
    employeeFields.style.display = "block";
    studentFields.style.display = "none";
    formRoleTitle.textContent = "Employee / Staff Registration";
    regEmail.placeholder = "username@nu-fairview.edu.ph";
  }
};

// ==========================================
// REGISTRATION HANDLER (validation + Firebase)
// ==========================================
// Runs from a plain button click (not a form "submit" event) so Chrome's
// "save password" prompt isn't triggered by invalid attempts.
async function handleRegister() {
  if (isSubmitting) return;

  clearErrors();

  const name = document.getElementById("regName").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  const password = document.getElementById("regPassword").value;
  const confirmPassword = document.getElementById("regConfirmPassword").value;

  let isValid = true;
  let firstInvalidId = null;

  // Marks a field invalid and remembers the first one so we can focus it
  function fail(inputId, message) {
    setError(inputId, message);
    isValid = false;
    if (!firstInvalidId) firstInvalidId = inputId;
  }

  // ------------------------------------------
  // FULL NAME
  // ------------------------------------------
  if (name === "") {
    fail("regName", "Full name is required.");
  } else if (!/^[A-Za-zÀ-ÿ.'\-\s]{2,}$/.test(name)) {
    fail("regName", "Name can only contain letters, spaces, . ' and -");
  }

  // ------------------------------------------
  // ROLE-SPECIFIC FIELDS
  // ------------------------------------------
  let studentId = "";
  let studentProgram = "";
  let studentYear = "";
  let employeeId = "";
  let employeeDept = "";

  if (currentRole === "student") {
    studentId = document.getElementById("studentId").value.trim();
    studentProgram = document.getElementById("studentProgram").value.trim();
    studentYear = document.getElementById("studentYear").value;

    // Pattern for format like 2022-1234567 (4 digits, hyphen, 7 digits)
    const studentIdPattern = /^\d{4}-\d{7}$/;

    if (studentId === "") {
      fail("studentId", "Student ID is required.");
    } else if (!studentIdPattern.test(studentId)) {
      fail("studentId", "Invalid format. Use YYYY-XXXXXXX (e.g., 2022-1234567).");
    }

    if (studentProgram === "") {
      fail("studentProgram", "Program is required.");
    }

    if (studentYear === "") {
      fail("studentYear", "Select your year level.");
    }
  } else {
    employeeId = document.getElementById("employeeId").value.trim();
    employeeDept = document.getElementById("employeeDept").value.trim();

    if (employeeId === "") {
      fail("employeeId", "Employee ID is required.");
    } else if (!/^[A-Z]{3}-\d{4}-\d{3}$/.test(employeeId)) {
      fail("employeeId", "Invalid format. Use AAA-YYYY-XXX (e.g., EMP-2023-089).");
    }

    if (employeeDept === "") {
      fail("employeeDept", "Department is required.");
    }
  }

  // ------------------------------------------
  // EMAIL
  // ------------------------------------------
  if (email === "") {
    fail("regEmail", "Email address is required.");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail("regEmail", "Enter a valid email address.");
  } else {
    const lower = email.toLowerCase();

    // Always enforced: employees/staff cannot use a student email
    if (currentRole === "employee" && lower.includes("@students")) {
      fail("regEmail", "Student emails (@students...) can't be used for Employee / Staff registration.");
    }
    // Optional strict NU-domain check (controlled by REQUIRE_NU_EMAIL)
    else if (REQUIRE_NU_EMAIL) {
      if (currentRole === "student" && !lower.endsWith("@students.nu-fairview.edu.ph")) {
        fail("regEmail", "Use your NU student email (@students.nu-fairview.edu.ph).");
      } else if (currentRole === "employee" && !lower.endsWith("@nu-fairview.edu.ph")) {
        fail("regEmail", "Use your NU employee email (@nu-fairview.edu.ph).");
      }
    }
  }

  // ------------------------------------------
  // PASSWORD
  // ------------------------------------------
  if (password === "") {
    fail("regPassword", "Password is required.");
  } else if (password.length < 8) {
    fail("regPassword", "Password must be at least 8 characters long.");
  }

  // ------------------------------------------
  // CONFIRM PASSWORD
  // ------------------------------------------
  if (confirmPassword === "") {
    fail("regConfirmPassword", "Please confirm your password.");
  } else if (password !== "" && password !== confirmPassword) {
    fail("regConfirmPassword", "Passwords do not match.");
  }

  // Stop here if anything is wrong, and jump to the first red field
  if (!isValid) {
    const firstField = document.getElementById(firstInvalidId);
    if (firstField) firstField.focus();
    return;
  }

  // ==========================================
  // FIREBASE REGISTRATION
  // ==========================================
  isSubmitting = true;
  if (registerBtn) registerBtn.disabled = true;

  try {
    // 1. Create Firebase Account
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // 2. Prepare Payload
    const userData = {
      name: name,
      email: email,
      role: currentRole,
      createdAt: new Date().toISOString()
    };

    if (currentRole === "student") {
      userData.studentId = studentId;
      userData.program = studentProgram;
      userData.yearLevel = studentYear;
    } else {
      userData.employeeId = employeeId;
      userData.department = employeeDept;
    }

    // 3. Save to the matching folder: students/{uid} or employees/{uid}
    const folder = currentRole === "student" ? "students" : "employees";
    await set(ref(db, `${folder}/${user.uid}`), userData);

    // 4. Success Redirect
    alert("Registration Successful!");
    window.location.href = "../login/login.html";

  } catch (error) {
    console.error("Registration error:", error);

    switch (error.code) {
      case "auth/email-already-in-use":
        setError("regEmail", "This email is already registered.");
        document.getElementById("regEmail").focus();
        break;

      case "auth/invalid-email":
        setError("regEmail", "Invalid email address.");
        document.getElementById("regEmail").focus();
        break;

      case "auth/weak-password":
        setError("regPassword", "Password is too weak.");
        document.getElementById("regPassword").focus();
        break;

      case "auth/network-request-failed":
        showGlobalError("Network error. Check your connection and try again.");
        break;

      case "auth/too-many-requests":
        showGlobalError("Too many attempts. Please try again later.");
        break;

      case "PERMISSION_DENIED":
      case "permission-denied":
        showGlobalError("Account created, but saving your details was denied. Contact the clinic.");
        break;

      default:
        showGlobalError("Registration failed. Please try again.");
        break;
    }
  } finally {
    isSubmitting = false;
    if (registerBtn) registerBtn.disabled = false;
  }
}

// Button click starts registration
if (registerBtn) {
  registerBtn.addEventListener("click", handleRegister);
}

// Keep the Enter key working inside the form
registerForm.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.tagName !== "BUTTON") {
    e.preventDefault();
    handleRegister();
  }
});

// Safety net: never let the browser do a native form submit
registerForm.addEventListener("submit", (e) => e.preventDefault());

// ==========================================
// PASSWORD TOGGLE EYE FUNCTION
// ==========================================
function setupToggle(iconId, inputId) {
  const icon = document.getElementById(iconId);
  const input = document.getElementById(inputId);

  if (icon && input) {
    icon.addEventListener("click", function () {
      if (input.type === "password") {
        input.type = "text";
        this.classList.replace("fa-eye", "fa-eye-slash");
      } else {
        input.type = "password";
        this.classList.replace("fa-eye-slash", "fa-eye");
      }
    });
  }
}

setupToggle("togglePassword", "regPassword");
setupToggle("toggleConfirmPassword", "regConfirmPassword");
