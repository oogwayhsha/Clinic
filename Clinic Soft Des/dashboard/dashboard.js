import { auth, db } from "../../Software Activity/Login/firebase/firebase.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  ref,
  get
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

// ==========================================
// AUTHENTICATION & SESSION HANDLING
// ==========================================
onAuthStateChanged(auth, async (user) => {
  if (user) {
    console.log("Logged in user:", user.uid);
    try {
      const userRef = ref(db, "users/" + user.uid);
      const snapshot = await get(userRef);

      if (snapshot.exists()) {
        const userData = snapshot.val();
        console.log("User data:", userData);

        // Display username inside header paragraph if present
        const welcomeHeader = document.querySelector(".dashboard-header p");
        if (welcomeHeader) {
          welcomeHeader.textContent = "Welcome back, " + userData.username + "!";
        }
      }
    } catch (error) {
      console.error("Error reading user data:", error);
    }
  } else {
    // No authenticated user redirect
    window.location.href = "../login/login.html";
  }
});

// ==========================================
// LOGOUT FUNCTIONALITY
// ==========================================
async function logout() {
  try {
    await signOut(auth);
    alert("You have been logged out.");
    window.location.href = "../login/login.html";
  } catch (error) {
    console.error("Logout error:", error);
  }
}

// Make logout available to inline HTML onclick handlers
window.logout = logout;

// ==========================================
// DASHBOARD UI INTERACTIONS
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  // Mobile & Desktop Profile Buttons
  const profileBtn = document.getElementById("profileBtn");
  const deskProfileBtn = document.getElementById("deskProfileBtn");

  // Mobile & Desktop Logout Buttons
  const mobileLogoutBtn = document.getElementById("mobileLogoutBtn");
  const desktopLogoutBtn = document.getElementById("desktopLogoutBtn");

  // Mobile Action Buttons
  const bookAppointmentBtn = document.getElementById("bookAppointmentBtn");
  const viewAppointmentsBtn = document.getElementById("viewAppointmentsBtn");

  // Desktop Action Buttons
  const deskBookBtn = document.getElementById("deskBookBtn");
  const deskViewBtn = document.getElementById("deskViewBtn");

  // Profile Event Listener
  const handleProfileClick = () => {
    alert("Profile Settings: Feature coming soon!");
  };

  if (profileBtn) {
    profileBtn.addEventListener("click", handleProfileClick);
  }
  if (deskProfileBtn) {
    deskProfileBtn.addEventListener("click", handleProfileClick);
  }

  // Logout Event Listeners
  if (mobileLogoutBtn) {
    mobileLogoutBtn.addEventListener("click", logout);
  }
  if (desktopLogoutBtn) {
    desktopLogoutBtn.addEventListener("click", logout);
  }

  // Appointment Event Listeners
  const handleBookingClick = () => {
    console.log("Navigating to Appointment Booking system...");
    alert("Redirecting to the online appointment booking scheduler...");
  };

  const handleViewClick = () => {
    console.log("Fetching user appointment list...");
    alert("Loading your upcoming appointments schedule...");
  };

  if (bookAppointmentBtn) {
    bookAppointmentBtn.addEventListener("click", handleBookingClick);
  }
  if (deskBookBtn) {
    deskBookBtn.addEventListener("click", handleBookingClick);
  }

  if (viewAppointmentsBtn) {
    viewAppointmentsBtn.addEventListener("click", handleViewClick);
  }
  if (deskViewBtn) {
    deskViewBtn.addEventListener("click", handleViewClick);
  }

  // Mobile Tap Micro-interactions
  const interactiveElements = document.querySelectorAll(
    ".action-card, .profile-btn, .mobile-logout-btn, .desktop-logout-btn, .feature-icon-wrapper, .desktop-hero-actions button"
  );

  interactiveElements.forEach((btn) => {
    btn.addEventListener("touchstart", () => {
      btn.style.transform = "scale(0.97)";
    });
    btn.addEventListener("touchend", () => {
      btn.style.transform = "";
    });
  });
});