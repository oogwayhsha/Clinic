let currentRole = "student";

// ALLOWED EMAIL DOMAIN PER ROLE
const EMAIL_DOMAINS = {
  student: "students.nu-fairview.edu.ph",
  employee: "nu-fairview.edu.ph"
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

// Validate email as soon as the user leaves the field
const regEmailInput = document.getElementById("regEmail");
if (regEmailInput) regEmailInput.addEventListener("blur", validateEmail);

// ID FORMAT PER ROLE (edit these to change the format)
const ID_FORMATS = {
  student: {
    inputId: "studentId",
    errorId: "studentIdError",
    label: "Student ID",
    pattern: /^\d{4}-\d{6}$/,
    example: "2023-123456",
    maxLength: 11,
    // digits only, hyphen after the 4th digit
    format: function (raw) {
      const d = raw.replace(/\D/g, "").slice(0, 10);
      return d.length > 4 ? d.slice(0, 4) + "-" + d.slice(4) : d;
    }
  },
  employee: {
    inputId: "employeeId",
    errorId: "employeeIdError",
    label: "Employee ID",
    pattern: /^EMP-\d{4}-\d{3}$/,
    example: "EMP-2024-001",
    maxLength: 12,
    // EMP- prefix added automatically, then 4 digits, hyphen, 3 digits
    format: function (raw) {
      const d = raw.replace(/\D/g, "").slice(0, 7);
      if (d === "") {
        // allow typing the "EMP" prefix by hand, otherwise clear
        const letters = raw.toUpperCase().replace(/[^A-Z]/g, "");
        return "EMP".startsWith(letters) ? letters : "";
      }
      return "EMP-" + d.slice(0, 4) + (d.length > 4 ? "-" + d.slice(4) : "");
    }
  }
};

// ID VALIDATION (checks the ID for the active role)
function validateId() {
  const fmt = ID_FORMATS[currentRole];
  const value = document.getElementById(fmt.inputId).value.trim();
  const errorEl = document.getElementById(fmt.errorId);

  if (value === "") {
    errorEl.textContent = `${fmt.label} is required.`;
    return false;
  }
  if (!fmt.pattern.test(value)) {
    errorEl.textContent = `Invalid ${fmt.label}. Use the format ${fmt.example}.`;
    return false;
  }
  errorEl.textContent = "";
  return true;
}

// AUTO-FORMAT: each role uses its own format() function
function setupIdFormatting(role) {
  const fmt = ID_FORMATS[role];
  const input = document.getElementById(fmt.inputId);

  if (!input) {
    console.warn(`#${fmt.inputId} not found, skipping ID formatting for ${role}`);
    return;
  }

  input.placeholder = fmt.example;
  input.maxLength = fmt.maxLength;

  input.addEventListener("input", function () {
    this.value = fmt.format(this.value);
  });

  // only validate on blur when this role is the active one
  input.addEventListener("blur", function () {
    if (currentRole === role) validateId();
  });
}

setupIdFormatting("student");
setupIdFormatting("employee");

// ROLE SWITCHER FUNCTION
function switchRole(role) {
  currentRole = role;

  const studentTab = document.getElementById("studentTab");
  const employeeTab = document.getElementById("employeeTab");
  const studentFields = document.getElementById("studentFields");
  const employeeFields = document.getElementById("employeeFields");
  const formRoleTitle = document.getElementById("formRoleTitle");
  const regEmail = document.getElementById("regEmail");

  // Clear previous error messages when switching
  clearErrors();

  // Clear email and IDs so wrong-role values can't carry over
  ["regEmail", "studentId", "employeeId"].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

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
}

// Expose to the page: <script type="module"> keeps functions private,
// so the inline onclick="switchRole(...)" buttons need this to find it
window.switchRole = switchRole;

// FORM SUBMISSION & VALIDATION
const registerForm = document.getElementById("registerForm");

registerForm.addEventListener("submit", function (event) {
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

  // Validate ID format (student or employee)
  if (!validateId()) {
    isValid = false;
  }

  // Validate the other role-specific field
  if (currentRole === "student") {
    const studentCourse = document.getElementById("studentCourse").value.trim();
    if (studentCourse === "") {
      document.getElementById("studentCourseError").textContent = "Course & Year is required.";
      isValid = false;
    }
  } else {
    const employeeDept = document.getElementById("employeeDept").value.trim();
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

  // If valid, simulate submission
  if (isValid) {
    alert(`Registration Successful as ${currentRole.toUpperCase()}! Redirecting to login...`);
    window.location.href = "https://oogwayhsha.github.io/index.html";
  }
});

// HELPER FUNCTION TO CLEAR ERRORS
function clearErrors() {
  const errorElements = document.querySelectorAll(".error");
  errorElements.forEach((el) => (el.textContent = ""));
  document.getElementById("regMessage").textContent = "";
}

// PASSWORD TOGGLE EYE FUNCTION
function setupToggle(iconId, inputId) {
  const icon = document.getElementById(iconId);
  const input = document.getElementById(inputId);

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

setupToggle("togglePassword", "regPassword");
setupToggle("toggleConfirmPassword", "regConfirmPassword");