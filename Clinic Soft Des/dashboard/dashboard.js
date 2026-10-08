// ==========================================
// FIREBASE IMPORTS
// ==========================================
import { auth, db } from "../firebase/firebase.js";

import {
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

import {
    ref,
    get
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";


// ==========================================
// DASHBOARD HANDLER
// ==========================================
document.addEventListener("DOMContentLoaded", () => {

    // ==========================================
    // ELEMENT SELECTORS
    // ==========================================

    // Profile Buttons
    const deskProfileBtn = document.getElementById("deskProfileBtn");
    const profileBtn = document.getElementById("profileBtn");

    // Logout Buttons
    const desktopLogoutBtn = document.getElementById("desktopLogoutBtn");
    const mobileLogoutBtn = document.getElementById("mobileLogoutBtn");

    // Appointment Buttons
    const deskBookBtn = document.getElementById("deskBookBtn");
    const deskViewBtn = document.getElementById("deskViewBtn");
    const bookAppointmentBtn = document.getElementById("bookAppointmentBtn");
    const viewAppointmentsBtn = document.getElementById("viewAppointmentsBtn");

    // Navigation Links
    const navLinks = document.querySelectorAll(".desktop-nav a");

    // User Display
    const userNameDisplay = document.getElementById("userNameDisplay");
    const userRoleDisplay = document.getElementById("userRoleDisplay");


    // ==========================================
    // PROFILE BUTTON
    // ==========================================

    function handleProfile() {
        window.location.href = "profile.html";
    }

    if (deskProfileBtn) {
        deskProfileBtn.addEventListener("click", handleProfile);
    }

    if (profileBtn) {
        profileBtn.addEventListener("click", handleProfile);
    }


    // ==========================================
    // FIREBASE AUTHENTICATION
    // ==========================================

    onAuthStateChanged(auth, async (user) => {

        if (user) {

            console.log("User logged in:", user.uid);

            try {

                // Get user data from Realtime Database
                const userRef = ref(db, `users/${user.uid}`);
                const snapshot = await get(userRef);

                if (snapshot.exists()) {

                    const userData = snapshot.val();

                    console.log("User Profile Data:", userData);

                    // Display user's name
                    if (userNameDisplay) {
                        userNameDisplay.textContent =
                            userData.fullName ||
                            userData.name ||
                            user.email;
                    }

                    // Display user's role
                    if (userRoleDisplay) {
                        userRoleDisplay.textContent =
                            userData.role || "Student";
                    }

                } else {

                    console.warn(
                        "No user profile record found in Realtime Database."
                    );

                    if (userNameDisplay) {
                        userNameDisplay.textContent = user.email;
                    }

                    if (userRoleDisplay) {
                        userRoleDisplay.textContent = "Student";
                    }
                }

            } catch (error) {

                console.error(
                    "Error fetching user data from Firebase:",
                    error
                );

            }

        } else {

            // No logged-in user
            console.warn(
                "No active session found. Redirecting to login..."
            );

            window.location.href = "../login/login.html";
        }
    });


    // ==========================================
    // NAVIGATION
    // ==========================================

    navLinks.forEach((link) => {

        link.addEventListener("click", (e) => {

            e.preventDefault();

            navLinks.forEach((item) => {
                item.classList.remove("active");
            });

            link.classList.add("active");

            const targetPage = link.textContent.trim();

            handleNavigation(targetPage);
        });

    });


    function handleNavigation(pageName) {

        console.log(`Navigating to: ${pageName}`);

    }


    // ==========================================
    // BOOK APPOINTMENT
    // ==========================================

    function handleBookAppointment() {

        console.log("Book Appointment clicked");

        window.location.href = "booking.html";
    }


    if (deskBookBtn) {
        deskBookBtn.addEventListener(
            "click",
            handleBookAppointment
        );
    }

    if (bookAppointmentBtn) {
        bookAppointmentBtn.addEventListener(
            "click",
            handleBookAppointment
        );
    }


    // ==========================================
    // VIEW APPOINTMENTS
    // ==========================================

    function handleViewAppointments() {

        console.log("View Appointments clicked");

        window.location.href = "my-appointments.html";
    }


    if (deskViewBtn) {
        deskViewBtn.addEventListener(
            "click",
            handleViewAppointments
        );
    }

    if (viewAppointmentsBtn) {
        viewAppointmentsBtn.addEventListener(
            "click",
            handleViewAppointments
        );
    }


    // ==========================================
    // LOGOUT
    // ==========================================

    async function handleLogout() {

        const confirmed = confirm(
            "Are you sure you want to log out?"
        );

        if (!confirmed) {
            return;
        }

        try {

            // Sign out from Firebase
            await signOut(auth);

            // Clear browser storage
            sessionStorage.clear();
            localStorage.clear();

            // Redirect to login
            window.location.href = "../login/login.html";

        } catch (error) {

            console.error(
                "Logout Error:",
                error
            );

            alert(
                "Failed to log out: " +
                error.message
            );
        }
    }


    if (desktopLogoutBtn) {
        desktopLogoutBtn.addEventListener(
            "click",
            handleLogout
        );
    }

    if (mobileLogoutBtn) {
        mobileLogoutBtn.addEventListener(
            "click",
            handleLogout
        );
    }

});