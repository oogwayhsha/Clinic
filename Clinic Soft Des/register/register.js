// ==========================================
// FIREBASE IMPORTS
// ==========================================
import { auth, db } from "../firebase/firebase.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { ref, set, get, onValue } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

let currentRole = "student";

// Set to true if only NU emails should be accepted
// (students: @students.nu-fairview.edu.ph, employees: @nu-fairview.edu.ph)
const REQUIRE_NU_EMAIL = true;

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
// STUDENT ID FORMATTER (YYYY-XXXXXX or YYYY-XXXXXXX)
// ==========================================
// Automatically inserts hyphen after 4 digits, allowing pure numbers or manual typing
function formatStudentId(value) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 4) return digits;
  return digits.slice(0, 4) + "-" + digits.slice(4);
}

const studentIdInput = document.getElementById("studentId");
if (studentIdInput) {
  studentIdInput.maxLength = 12;
  studentIdInput.addEventListener("input", () => {
    studentIdInput.value = formatStudentId(studentIdInput.value);
  });
}

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
    studentId = formatStudentId(document.getElementById("studentId").value.trim());
    document.getElementById("studentId").value = studentId;
    studentProgram = document.getElementById("studentProgram").value.trim();
    studentYear = document.getElementById("studentYear").value;

    // Pattern for format like 2022-1234567 (4 digits, hyphen, 7 digits)
    const studentIdPattern = /^\d{4}-\d{6,7}$/;

    if (studentId === "") {
      fail("studentId", "Student ID is required.");
    } else if (!studentIdPattern.test(studentId)) {
      fail("studentId", "Invalid format. Use YYYY-XXXXXX or YYYY-XXXXXXX (e.g., 2022-123456).");
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

  // ------------------------------------------
  // RFID UNIQUENESS CHECK
  // ------------------------------------------
  const rfidUid = document.getElementById("regRfid")?.value.trim().replace(/[^A-Za-z0-9]/g, "").toUpperCase() || "";

  if (rfidUid) {
    try {
      const existingSnap = await get(ref(db, `rfid_lookup/${rfidUid}`));
      if (existingSnap.exists()) {
        setError("regRfid", "This RFID card is already registered to another account.");
        if (regRfidStatus) {
          regRfidStatus.textContent = "This card is already linked to another user.";
          regRfidStatus.style.color = "#ef4444";
        }
        document.getElementById("regRfid")?.focus();
        return;
      }
    } catch (checkErr) {
      console.warn("Could not check RFID uniqueness:", checkErr);
    }
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
    const rfidUid = document.getElementById("regRfid")?.value.trim().replace(/[^A-Za-z0-9]/g, "").toUpperCase() || "";

    const userData = {
      name: name,
      email: email,
      role: currentRole,
      createdAt: new Date().toISOString()
    };

    if (rfidUid) {
      userData.rfidUid = rfidUid;
    }

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

    // 4. Save RFID Lookup Index if card was provided
    if (rfidUid) {
      try {
        await set(ref(db, `rfid_lookup/${rfidUid}`), {
          uid: user.uid,
          email: email,
          role: currentRole,
          name: name,
          authKey: password
        });
      } catch (rfidErr) {
        console.warn("Could not save rfid_lookup entry:", rfidErr);
      }
    }

    // 5. Success Redirect
    alert("Registration Successful!" + (rfidUid ? "\nRFID Card linked successfully!" : ""));
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

// ==========================================
// DIRECT PHONE NFC SCANNER + LIVE TAP SYNC
// ==========================================
const regRfidInput = document.getElementById("regRfid");
const scanNfcBtn = document.getElementById("scanNfcBtn");
const regRfidStatus = document.getElementById("regRfidStatus");

if (regRfidInput) {
  // 1. Direct Phone NFC Scanner (when registering directly on smartphone)
  if (scanNfcBtn) {
    scanNfcBtn.addEventListener("click", async () => {
      if (!("NDEFReader" in window)) {
        alert("Direct phone tapping requires Google Chrome on an Android phone with NFC turned on.\n\nIf you are on a computer, you can type the UID or use your phone scanner station.");
        return;
      }

      try {
        const ndef = new NDEFReader();
        await ndef.scan();

        scanNfcBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Hold card to back...`;
        scanNfcBtn.style.background = "#10b981";
        scanNfcBtn.style.color = "#ffffff";
        if (regRfidStatus) {
          regRfidStatus.textContent = "Hold your student/employee ID against the back of your phone...";
          regRfidStatus.style.color = "#ffd41d";
        }

        ndef.onreading = async (event) => {
          const rawSerial = event.serialNumber;
          if (!rawSerial) return;
          const cleanUid = rawSerial.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

          regRfidInput.value = cleanUid;
          if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

          scanNfcBtn.innerHTML = `<i class="fa-solid fa-check"></i> Scanned!`;
          scanNfcBtn.style.background = "#35408e";
          scanNfcBtn.style.color = "#ffd41d";

          try {
            const checkSnap = await get(ref(db, `rfid_lookup/${cleanUid}`));
            if (checkSnap.exists()) {
              setError("regRfid", "This RFID card is already linked to another account.");
              if (regRfidStatus) {
                regRfidStatus.textContent = "Card is already registered to another user!";
                regRfidStatus.style.color = "#ef4444";
              }
            } else {
              clearFieldError(regRfidInput);
              if (regRfidStatus) {
                regRfidStatus.textContent = `Card UID: ${cleanUid} is available!`;
                regRfidStatus.style.color = "#10b981";
              }
            }
          } catch (err) {
            if (regRfidStatus) {
              regRfidStatus.textContent = `Card UID: ${cleanUid} captured!`;
              regRfidStatus.style.color = "#10b981";
            }
          }
        };

        ndef.onreadingerror = () => {
          if (regRfidStatus) {
            regRfidStatus.textContent = "Could not read card. Hold it steady against the back of your phone.";
            regRfidStatus.style.color = "#ef4444";
          }
        };
      } catch (err) {
        console.error("NFC activation error:", err);
        alert("NFC Error: " + err.message);
      }
    });
  }

  // 2. Realtime listener (when registering on PC and tapping card on phone scanner)
  let lastRegTap = 0;
  onValue(ref(db, "rfid_tap"), async (snapshot) => {
    const tap = snapshot.val();
    if (!tap || !tap.cardUid || !tap.timestamp) return;
    if (tap.timestamp <= lastRegTap || Date.now() - tap.timestamp > 20000) return;
    lastRegTap = tap.timestamp;

    const cleanUid = String(tap.cardUid).trim().replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    regRfidInput.value = cleanUid;

    try {
      const checkSnap = await get(ref(db, `rfid_lookup/${cleanUid}`));
      if (checkSnap.exists()) {
        setError("regRfid", "This RFID card is already linked to another account.");
        if (regRfidStatus) {
          regRfidStatus.textContent = "Card is already registered to another user!";
          regRfidStatus.style.color = "#ef4444";
        }
      } else {
        clearFieldError(regRfidInput);
        regRfidInput.style.borderColor = "#10b981";
        if (regRfidStatus) {
          regRfidStatus.textContent = `Card UID ${cleanUid} is available!`;
          regRfidStatus.style.color = "#10b981";
        }
        setTimeout(() => {
          regRfidInput.style.borderColor = "";
        }, 2000);
      }
    } catch (err) {
      regRfidInput.style.borderColor = "#10b981";
      setTimeout(() => {
        regRfidInput.style.borderColor = "";
      }, 2000);
    }
  });

  // 3. Manual change validation
  regRfidInput.addEventListener("change", async () => {
    const val = regRfidInput.value.trim().replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (!val) {
      clearFieldError(regRfidInput);
      if (regRfidStatus) regRfidStatus.textContent = "";
      return;
    }
    regRfidInput.value = val;
    try {
      const checkSnap = await get(ref(db, `rfid_lookup/${val}`));
      if (checkSnap.exists()) {
        setError("regRfid", "This RFID card is already linked to another account.");
        if (regRfidStatus) {
          regRfidStatus.textContent = "Card is already registered to another user!";
          regRfidStatus.style.color = "#ef4444";
        }
      } else {
        clearFieldError(regRfidInput);
        if (regRfidStatus) {
          regRfidStatus.textContent = `Card UID ${val} is available!`;
          regRfidStatus.style.color = "#10b981";
        }
      }
    } catch (err) {}
  });
}
