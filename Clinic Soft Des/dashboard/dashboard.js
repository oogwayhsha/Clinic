// ==========================================
// FIREBASE IMPORTS
// ==========================================
import { auth, db } from "../../Software Activity/firebase.js";

import {
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

import {
    ref,
    get,
    push,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

// ==========================================
// ROLE -> PAGE ROUTING
// ==========================================
// The hard-coded admin account (same UID as admin.js and your database rules)
const ADMIN_UID = "dMcFELN1ildDnJL4AEwUxAq0SLE2";

const ADMIN_PAGE = "../admin/admin.html";

const PAGES = {
    student: {
        profile: "../student/student-profile.html",
        appointment: "../student/st-appointment.html"
    },
    employee: {
        profile: "../employee/employee-profile.html",
        appointment: "../employee/em-appointment.html"
    }
};


// ==========================================
// DASHBOARD + SHARED PAGE HANDLER
// ==========================================
document.addEventListener("DOMContentLoaded", () => {

    // ==========================================
    // ELEMENT SELECTORS
    // ==========================================

    // Profile Buttons
    const deskProfileBtn = document.getElementById("deskProfileBtn");
    const profileBtn = document.getElementById("profileBtn");

    // Logout Buttons (by id, plus any button marked data-logout)
    const logoutButtons = new Set([
        document.getElementById("desktopLogoutBtn"),
        document.getElementById("mobileLogoutBtn"),
        ...document.querySelectorAll("[data-logout]")
    ]);
    logoutButtons.delete(null);

    // Appointment Buttons
    const deskBookBtn = document.getElementById("deskBookBtn");
    const deskViewBtn = document.getElementById("deskViewBtn");
    const bookAppointmentBtn = document.getElementById("bookAppointmentBtn");
    const viewAppointmentsBtn = document.getElementById("viewAppointmentsBtn");

    // Navigation Links (desktop nav + mobile tabs)
    const navLinks = document.querySelectorAll(".desktop-nav a, .page-tabs a");

    // Service Cards
    const serviceCards = document.querySelectorAll(".service-card");

    // User Display
    const userNameDisplay = document.getElementById("userNameDisplay");
    const userRoleDisplay = document.getElementById("userRoleDisplay");

    // Role of the logged-in user: "student", "employee" or "admin".
    // Set once we know who is logged in.
    let currentRole = "student";


    // ==========================================
    // ROUTES FOR THE CURRENT ROLE
    // ==========================================

    // Page that books / lists appointments for this role
    function appointmentPage() {
        return currentRole === "admin"
            ? ADMIN_PAGE
            : PAGES[currentRole].appointment;
    }

    function profilePage() {
        return currentRole === "admin"
            ? ADMIN_PAGE
            : PAGES[currentRole].profile;
    }

    // Service cards link straight to the right booking page with ?service=
    function updateServiceLinks() {
        serviceCards.forEach((card) => {
            const service = card.dataset.service;

            card.setAttribute(
                "href",
                currentRole === "admin"
                    ? ADMIN_PAGE
                    : `${appointmentPage()}?service=${service}`
            );
        });
    }

    // The admin has no profile page, so hide the profile buttons for them
    function updateProfileButtons() {
        [deskProfileBtn, profileBtn].forEach((btn) => {
            if (btn) btn.hidden = currentRole === "admin";
        });
    }

    updateServiceLinks();


    // ==========================================
    // PROFILE BUTTON
    // Students go to the student profile, employees to the employee profile.
    // ==========================================

    function handleProfile(event) {
        if (event) event.preventDefault();
        window.location.href = profilePage();
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

    let currentUser = null;

    onAuthStateChanged(auth, async (user) => {

        if (!user) {

            console.warn(
                "No active session found. Redirecting to login..."
            );

            window.location.href = "../login/login.html";
            return;
        }

        currentUser = user;

        console.log("User logged in:", user.uid);

        // Pre-fill the contact form (if this page has one)
        const nameInput = document.getElementById("contactName");
        const emailInput = document.getElementById("contactEmail");

        if (nameInput && !nameInput.value) {
            nameInput.value = user.displayName || "";
        }

        if (emailInput && !emailInput.value) {
            emailInput.value = user.email || "";
        }

        // ---- Admin: no student/employee record, so skip the lookup ----
        if (user.uid === ADMIN_UID) {

            currentRole = "admin";

            if (userNameDisplay) {
                userNameDisplay.textContent = user.displayName || user.email || "Admin";
            }

            if (userRoleDisplay) {
                userRoleDisplay.textContent = "Admin";
            }

            updateServiceLinks();
            updateProfileButtons();
            return;
        }

        // ---- Student / employee: look in students/{uid}, then employees/{uid} ----
        try {

            let userData = null;

            const studentSnap = await get(ref(db, `students/${user.uid}`));

            if (studentSnap.exists()) {
                currentRole = "student";
                userData = studentSnap.val();
            } else {
                const employeeSnap = await get(ref(db, `employees/${user.uid}`));

                if (employeeSnap.exists()) {
                    currentRole = "employee";
                    userData = employeeSnap.val();
                }
            }

            if (userData) {

                console.log("User Profile Data:", userData);

                if (userNameDisplay) {
                    userNameDisplay.textContent =
                        userData.fullName ||
                        userData.name ||
                        user.email;
                }

                if (userRoleDisplay) {
                    userRoleDisplay.textContent = currentRole;
                }

            } else {

                console.warn(
                    "No student or employee record found for this account."
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

        updateServiceLinks();
        updateProfileButtons();
    });


    // ==========================================
    // NAVIGATION
    // ==========================================

    navLinks.forEach((link) => {

        link.addEventListener("click", (e) => {

            e.preventDefault();

            const href = link.getAttribute("href");

            navLinks.forEach((item) => {
                item.classList.toggle(
                    "active",
                    item.getAttribute("href") === href
                );
            });

            if (href && href.length > 1 && href.startsWith("#")) {
                document.querySelector(href)?.scrollIntoView({
                    behavior: "smooth",
                    block: "start"
                });
            } else {
                window.scrollTo({ top: 0, behavior: "smooth" });
            }
        });

    });


    // ==========================================
    // SERVICE CARDS
    // The link is set by updateServiceLinks(); we refresh it again on click
    // in case the role loaded after the page rendered.
    // ==========================================

    serviceCards.forEach((card) => {

        card.addEventListener("click", () => {

            const service = card.dataset.service;

            console.log("Service selected:", service);

            updateServiceLinks();

            try {
                sessionStorage.setItem("selectedService", service);
            } catch (error) {
                console.warn("Could not store selected service:", error);
            }
        });

    });


    // ==========================================
    // BOOK APPOINTMENT
    // ==========================================

    function handleBookAppointment() {

        console.log("Book Appointment clicked");

        window.location.href = appointmentPage();
    }

    if (deskBookBtn) {
        deskBookBtn.addEventListener("click", handleBookAppointment);
    }

    if (bookAppointmentBtn) {
        bookAppointmentBtn.addEventListener("click", handleBookAppointment);
    }


    // ==========================================
    // VIEW APPOINTMENTS
    // Opens the same page on its "My Appointments" tab.
    // ==========================================

    function handleViewAppointments() {

        console.log("View Appointments clicked");

        window.location.href = currentRole === "admin"
            ? ADMIN_PAGE
            : `${appointmentPage()}?tab=mine`;
    }

    if (deskViewBtn) {
        deskViewBtn.addEventListener("click", handleViewAppointments);
    }

    if (viewAppointmentsBtn) {
        viewAppointmentsBtn.addEventListener("click", handleViewAppointments);
    }


    // ==========================================
    // LOGOUT (desktop + mobile)
    // ==========================================

    async function handleLogout(event) {

        if (event) {
            event.preventDefault();
        }

        const confirmed = confirm("Are you sure you want to log out?");

        if (!confirmed) {
            return;
        }

        try {

            await signOut(auth);

            sessionStorage.clear();
            localStorage.clear();

            window.location.href = "../login/login.html";

        } catch (error) {

            console.error("Logout Error:", error);

            alert("Failed to log out: " + error.message);
        }
    }

    logoutButtons.forEach((btn) => {
        btn.addEventListener("click", handleLogout);
    });


    // ==========================================
    // SCHEDULE: highlight today + open/closed status
    // ==========================================

    function toMinutes(time) {
        const [h, m] = time.split(":").map(Number);
        return h * 60 + m;
    }

    function formatTime(time) {
        const [h, m] = time.split(":").map(Number);
        const period = h >= 12 ? "PM" : "AM";
        const hour = h % 12 || 12;
        return `${hour}:${String(m).padStart(2, "0")} ${period}`;
    }

    function setupSchedule() {

        const banner = document.getElementById("clinicStatus");
        const rows = document.querySelectorAll("tr[data-day]");

        if (rows.length === 0) return;

        const now = new Date();
        const todayIndex = now.getDay();
        const minutesNow = now.getHours() * 60 + now.getMinutes();

        const todayRow = document.querySelector(`tr[data-day="${todayIndex}"]`);

        if (todayRow) {
            todayRow.classList.add("today");

            const firstCell = todayRow.querySelector("td");

            if (firstCell && !firstCell.querySelector(".today-tag")) {
                const tag = document.createElement("span");
                tag.className = "today-tag";
                tag.textContent = "TODAY";
                firstCell.appendChild(tag);
            }
        }

        if (!banner) return;

        const text = banner.querySelector(".status-text");

        if (todayRow && todayRow.dataset.open) {

            const open = toMinutes(todayRow.dataset.open);
            const close = toMinutes(todayRow.dataset.close);

            if (minutesNow >= open && minutesNow < close) {
                banner.className = "status-banner open";
                text.textContent =
                    `The clinic is open now · Closes at ${formatTime(todayRow.dataset.close)}`;
                return;
            }

            if (minutesNow < open) {
                banner.className = "status-banner closed";
                text.textContent =
                    `The clinic is closed right now · Opens today at ${formatTime(todayRow.dataset.open)}`;
                return;
            }
        }

        for (let i = 1; i <= 7; i++) {

            const dayIndex = (todayIndex + i) % 7;
            const row = document.querySelector(`tr[data-day="${dayIndex}"]`);

            if (row && row.dataset.open) {

                const label = i === 1 ? "tomorrow" : row.dataset.name;

                banner.className = "status-banner closed";
                text.textContent =
                    `The clinic is closed right now · Opens ${label} at ${formatTime(row.dataset.open)}`;
                return;
            }
        }
    }

    setupSchedule();


    // ==========================================
    // CONTACT FORM (only runs if the page has one)
    // ==========================================

    const contactForm = document.getElementById("contactForm");

    if (contactForm) {

        const statusBox = document.getElementById("formStatus");
        const submitBtn = document.getElementById("contactSubmit");

        function showStatus(type, message) {
            statusBox.className = `form-status ${type}`;
            statusBox.textContent = message;
        }

        contactForm.addEventListener("submit", async (event) => {

            event.preventDefault();

            const name = document.getElementById("contactName").value.trim();
            const email = document.getElementById("contactEmail").value.trim();
            const subject = document.getElementById("contactSubject").value;
            const message = document.getElementById("contactMessage").value.trim();

            if (!name || !email || !subject || !message) {
                showStatus("error", "Please complete all fields.");
                return;
            }

            if (message.length < 10) {
                showStatus("error", "Please write a message of at least 10 characters.");
                return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = "Sending...";

            try {

                await push(ref(db, "contactMessages"), {
                    uid: currentUser ? currentUser.uid : null,
                    name,
                    email,
                    subject,
                    message,
                    status: "unread",
                    createdAt: serverTimestamp()
                });

                contactForm.reset();

                if (currentUser) {
                    document.getElementById("contactName").value =
                        currentUser.displayName || name;
                    document.getElementById("contactEmail").value =
                        currentUser.email || email;
                }

                showStatus(
                    "success",
                    "Thank you! Your message has been sent. The clinic will get back to you soon."
                );

            } catch (error) {

                console.error("Contact form error:", error);

                showStatus(
                    "error",
                    "Sorry, your message could not be sent. Please try again or contact the clinic directly."
                );

            } finally {

                submitBtn.disabled = false;
                submitBtn.textContent = "Send Message";
            }
        });
    }

});