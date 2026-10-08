// ==========================================
// FIREBASE IMPORTS
// ==========================================
import { auth, db } from "../firebase/firebase.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { ref, set } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

let currentRole = "student";

// ALLOWED EMAIL DOMAIN PER ROLE
const EMAIL_DOMAINS = {
  student: "students.nu-fairview.edu.ph",
  employee: "nu-fairview.edu.ph"
};

// ROLE SWITCHER FUNCTION
// Explicitly attach to window so inline onclick="switchRole(...)" can access it in ES modules
window.switchRole = function (role) {
  currentRole = role;

  const studentTab = document.getElementById("studentTab");
  const employeeTab = document.getElementById("employeeTab");
  const studentFields = document.getElementById("studentFields");
  const employeeFields = document.getElementById("employeeFields");
  const formRoleTitle = document.getElementById("formRoleTitle");
  const regEmail = document.getElementById("regEmail");

  // Clear previous error messages when switching tabs
  clearErrors();

  // Clear the email so a wrong-role email can't carry over
  regEmail.value = "";

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

// EMAIL VALIDATION (role-based domain check)
function validateEmail() {
  const email = document.getElementById("regEmail").value.trim().toLowerCase();
  const errorEl = document.getElementById("regEmailError");
  const domain = EMAIL_DOMAINS[currentRole];

  // username + exact domain match after the "@"
  const pattern = new RegExp(`^[a-z0-9._%+-]+@${domain.replace(/\./g, "\\.")}$`);

  if (email === "") {
    errorEl.textContent = "Email address is required.";
    return false;
  }
  if (!pattern.test(email)) {
    errorEl.textContent = `Please use your NU ${currentRole} email (@${domain}).`;
    return false;
  }
  errorEl.textContent = "";
  return true;
}

// FORM SUBMISSION & VALIDATION
const registerForm = document.getElementById("registerForm");

registerForm.addEventListener("submit", async function (event) {
  event.preventDefault();

  clearErrors();

  const name = document.getElementById("regName").value.trim();
  const password = document.getElementById("regPassword").value;
  const confirmPassword = document.getElementById("regConfirmPassword").value;

  let isValid = true;

  // Validate Name
  if (name === "") {
    document.getElementById("regNameError").textContent = "Full name is required.";
    isValid = false;
  }

  // Role-specific Variables
  let studentId = "";
  let studentCourse = "";
  let employeeId = "";
  let employeeDept = "";

  // Validate Role-Specific Fields
// Inside registerForm.addEventListener("submit", ...)

if (currentRole === "student") {
  studentId = document.getElementById("studentId").value.trim();
  studentCourse = document.getElementById("studentCourse").value.trim();

  // Pattern for format like 2022-123456
  const studentIdPattern = /^\d{4}-\d{6}$/; 

  if (studentId === "") {
    document.getElementById("studentIdError").textContent = "Student ID is required.";
    isValid = false;
  } else if (!studentIdPattern.test(studentId)) {
    document.getElementById("studentIdError").textContent = "Invalid format. Use YYYY-XXXXXX (e.g., 2022-123456).";
    isValid = false;
  }

  if (studentCourse === "") {
    document.getElementById("studentCourseError").textContent = "Course & Year is required.";
    isValid = false;
  }
  } else {
    employeeId = document.getElementById("employeeId").value.trim();
    employeeDept = document.getElementById("employeeDept").value.trim();

    if (employeeId === "") {
      document.getElementById("employeeIdError").textContent = "Employee ID is required.";
      isValid = false;
    }
    if (employeeDept === "") {
      document.getElementById("employeeDeptError").textContent = "Department is required.";
      isValid = false;
    }
  }

  // Validate Email (student: @students.nu-fairview.edu.ph, employee: @nu-fairview.edu.ph)
  if (!validateEmail()) {
    isValid = false;
  }

  // Validate Password
  if (password === "") {
    document.getElementById("regPasswordError").textContent = "Password is required.";
    isValid = false;
  } else if (password.length < 8) {
    document.getElementById("regPasswordError").textContent = "Password must be at least 8 characters long.";
    isValid = false;
  }

  // Validate Confirm Password
  if (confirmPassword === "") {
    document.getElementById("regConfirmPasswordError").textContent = "Please confirm your password.";
    isValid = false;
  } else if (password !== "" && password !== confirmPassword) {
    document.getElementById("regConfirmPasswordError").textContent = "Passwords do not match.";
    isValid = false;
  }

  // Submit if Valid
  if (isValid) {
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
        userData.course = studentCourse;
      } else {
        userData.employeeId = employeeId;
        userData.department = employeeDept;
      }

      // 3. Save User Data to Realtime Database
      await set(ref(db, `users/${user.uid}`), userData);

      // 4. Success Redirect
      alert("Registration Successful!");
      window.location.href = "../login/login.html";

    } catch (error) {
      console.error("Registration error:", error);

      // Map error messages to correct DOM element IDs
      const emailError = document.getElementById("regEmailError");
      const passwordError = document.getElementById("regPasswordError");
      const globalMessage = document.getElementById("regMessage");

      switch (error.code) {
        case "auth/email-already-in-use":
          if (emailError) emailError.textContent = "This email is already registered.";
          break;
        case "auth/invalid-email":
          if (emailError) emailError.textContent = "Invalid email address.";
          break;
        case "auth/weak-password":
          if (passwordError) passwordError.textContent = "Password is too weak.";
          break;
        default:
          if (globalMessage) globalMessage.textContent = "Registration failed. Please try again.";
          break;
      }
    }
  }
});

// Validate email as soon as the user leaves the field
document.getElementById("regEmail").addEventListener("blur", validateEmail);

// HELPER FUNCTION TO CLEAR ERRORS
function clearErrors() {
  const errorElements = document.querySelectorAll(".error");
  errorElements.forEach((el) => (el.textContent = ""));

  const regMessage = document.getElementById("regMessage");
  if (regMessage) regMessage.textContent = "";
}

// PASSWORD TOGGLE EYE FUNCTION
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