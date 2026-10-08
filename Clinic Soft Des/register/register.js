let currentRole = "student";

// ALLOWED EMAIL DOMAIN PER ROLE
const EMAIL_DOMAINS = {
  student: "students.nu-fairview.edu.ph",
  employee: "nu-fairview.edu.ph"
};

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
}

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

  // Validate Role-Specific Fields
  if (currentRole === "student") {
    const studentId = document.getElementById("studentId").value.trim();
    const studentCourse = document.getElementById("studentCourse").value.trim();

    if (studentId === "") {
      document.getElementById("studentIdError").textContent = "Student ID is required.";
      isValid = false;
    }
    if (studentCourse === "") {
      document.getElementById("studentCourseError").textContent = "Course & Year is required.";
      isValid = false;
    }
  } else {
    const employeeId = document.getElementById("employeeId").value.trim();
    const employeeDept = document.getElementById("employeeDept").value.trim();

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

  // If valid, simulate submission
  if (isValid) {
    alert(`Registration Successful as ${currentRole.toUpperCase()}! Redirecting to login...`);
    window.location.href = "https://oogwayhsha.github.io/index.html";
  }
});

// Validate email as soon as the user leaves the field
document.getElementById("regEmail").addEventListener("blur", validateEmail);

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