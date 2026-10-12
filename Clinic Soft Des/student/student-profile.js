import { auth, db } from "../firebase/firebase.js";

import {
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

import {
    ref,
    get,
    update,
    query,
    orderByChild,
    equalTo
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";


document.addEventListener("DOMContentLoaded", () => {

    /* =========================================
       ELEMENTS
    ========================================= */

    const $ = (id) => document.getElementById(id);

    const personalModal = $("profileModal");
    const personalForm = $("profileForm");
    const editPersonalBtn = $("editPersonalBtn");

    const editName = $("editName");
    const editEmail = $("editEmail");
    const editPhone = $("editPhone");
    const editProgram = $("editProgram");
    const editYearLevel = $("editYearLevel");

    const emergencyModal = $("emergencyModal");
    const emergencyForm = $("emergencyForm");
    const editEmergencyBtn = $("editEmergencyBtn");

    const editEmergencyName = $("editEmergencyName");
    const editRelationship = $("editRelationship");
    const editEmergencyPhone = $("editEmergencyPhone");

    const avatar = $("avatar");

    let currentUser = null;
    let currentData = {};

    // Where employees go if they open the student page by mistake
    const EMPLOYEE_PAGE = "employee-profile.html";

    // Student records are saved at students/{uid}
    const PROFILE_PATH = (uid) => `students/${uid}`;


    /* =========================================
       HELPERS
    ========================================= */

    const NOT_PROVIDED = "Not provided";
    const PHONE_PATTERN = /^[+()\-\s\d]{7,20}$/;

    function setText(id, value, fallback = NOT_PROVIDED) {
        const el = $(id);
        if (!el) return;
        const text = value === undefined || value === null ? "" : String(value).trim();
        el.textContent = text || fallback;
    }

    function getInitials(name) {
        const initials = (name || "")
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part.charAt(0).toUpperCase())
            .join("");
        return initials || "ST";
    }

    function setSaving(form, saving) {
        const button = form.querySelector(".save-btn");
        if (!button) return;
        button.disabled = saving;
        button.textContent = saving ? "Saving..." : "Save Changes";
    }


    /* =========================================
       RENDER PROFILE
    ========================================= */

    function renderProfile(data, user) {

        const name = data.fullName || data.name || user.displayName || "";
        const emailAddress = data.email || user.email || "";
        const phoneNumber = data.phone || data.contactNumber || data.mobile || "";

        setText("summaryName", name, "Student");
        setText("summaryId", data.studentId);
        avatar.textContent = getInitials(name);

        setText("fullName", name);
        setText("studentId", data.studentId);
        setText("email", emailAddress);
        setText("phone", phoneNumber);
        setText("program", data.program || data.course);
        setText("yearLevel", data.yearLevel || data.year);

        setText("emergencyName", data.emergencyName || data.emergencyContact?.name);
        setText("relationship", data.relationship || data.emergencyContact?.relationship);
        setText("emergencyPhone", data.emergencyPhone || data.emergencyContact?.phone);

        currentData = {
            ...data,
            fullName: name,
            email: emailAddress,
            phone: phoneNumber
        };
    }


    /* =========================================
       APPOINTMENT COUNTS
       Reads this user's own appointments (appointments/{id} where uid matches).
       The rules allow this query only when it filters on the user's own uid.
    ========================================= */

    async function loadAppointmentStats(uid, profile) {

        let total = Number(profile.appointmentCount) || 0;
        let completed = Number(profile.completedAppointments) || 0;

        try {

            const snapshot = await get(
                query(ref(db, "appointments"), orderByChild("uid"), equalTo(uid))
            );

            if (snapshot.exists()) {

                const list = Object.values(snapshot.val());

                total = list.length;
                completed = list.filter(
                    (item) => String(item.status || "").toLowerCase() === "completed"
                ).length;
            }

        } catch (error) {
            console.warn("Could not load appointment counts:", error);
        }

        setText("appointmentCount", total, "0");
        setText("completedCount", completed, "0");
    }


    /* =========================================
       PREFERENCES
    ========================================= */

    const preferenceInputs = [
        $("appointmentReminder"),
        $("scheduleUpdates")
    ].filter(Boolean);

    function applyPreferences(preferences = {}) {
        preferenceInputs.forEach((input) => {
            if (typeof preferences[input.id] === "boolean") {
                input.checked = preferences[input.id];
            }
        });
    }

    preferenceInputs.forEach((input) => {

        input.addEventListener("change", async () => {

            if (!currentUser) return;

            try {
                await update(ref(db, `${PROFILE_PATH(currentUser.uid)}/preferences`), {
                    [input.id]: input.checked
                });
            } catch (error) {
                console.error("Could not save preference:", error);
                input.checked = !input.checked;
                alert("Unable to save your preference. Please try again.");
            }
        });
    });


    /* =========================================
       CHECK AUTHENTICATION + LOAD DATA
    ========================================= */

    onAuthStateChanged(auth, async (user) => {

        if (!user) {
            window.location.href = "../login/login.html";
            return;
        }

        currentUser = user;

        try {

            const snapshot = await get(ref(db, PROFILE_PATH(user.uid)));

            // Not a student? Send employees to their own page
            if (!snapshot.exists()) {
                const employeeSnap = await get(ref(db, `employees/${user.uid}`));
                if (employeeSnap.exists()) {
                    window.location.replace(EMPLOYEE_PAGE);
                    return;
                }
                console.warn("No profile record found for:", user.uid);
            }

            const data = snapshot.exists() ? snapshot.val() : {};

            renderProfile(data, user);
            applyPreferences(data.preferences);
            await loadAppointmentStats(user.uid, data);

        } catch (error) {

            console.error("Failed to load profile:", error);
            renderProfile({}, user);
            alert("Failed to load profile: " + error.message);
        }
    });


    /* =========================================
       MODALS
    ========================================= */

    function openModal(modal, focusEl) {
        modal.classList.add("show");
        if (focusEl) focusEl.focus();
    }

    function closeModal(modal) {
        modal.classList.remove("show");
    }

    function openPersonalModal() {

        editName.value = currentData.fullName || "";
        editEmail.value = currentData.email || "";
        editPhone.value = currentData.phone || "";
        editProgram.value = currentData.program || currentData.course || "";

        const savedYear = (currentData.yearLevel || currentData.year || "").toString().trim();
        if (savedYear && ![...editYearLevel.options].some((o) => o.value === savedYear)) {
            editYearLevel.add(new Option(savedYear, savedYear));
        }
        editYearLevel.value = savedYear;

        openModal(personalModal, editName);
    }

    function openEmergencyModal() {

        editEmergencyName.value = currentData.emergencyName || currentData.emergencyContact?.name || "";
        editRelationship.value = currentData.relationship || currentData.emergencyContact?.relationship || "";
        editEmergencyPhone.value = currentData.emergencyPhone || currentData.emergencyContact?.phone || "";

        openModal(emergencyModal, editEmergencyName);
    }

    editPersonalBtn.addEventListener("click", openPersonalModal);
    editEmergencyBtn.addEventListener("click", openEmergencyModal);

    $("modalClose").addEventListener("click", () => closeModal(personalModal));
    $("cancelBtn").addEventListener("click", () => closeModal(personalModal));

    $("emergencyModalClose").addEventListener("click", () => closeModal(emergencyModal));
    $("emergencyCancelBtn").addEventListener("click", () => closeModal(emergencyModal));

    [personalModal, emergencyModal].forEach((modal) => {
        modal.addEventListener("click", (event) => {
            if (event.target === modal) closeModal(modal);
        });
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeModal(personalModal);
            closeModal(emergencyModal);
        }
    });


    /* =========================================
       SAVE PERSONAL INFORMATION
       Email is read-only: it is the login email, and changing only the
       database copy would make it differ from the Firebase Auth account.
    ========================================= */

    personalForm.addEventListener("submit", async (event) => {

        event.preventDefault();

        if (!currentUser) {
            alert("You are not logged in.");
            return;
        }

        const name = editName.value.trim();
        const newPhone = editPhone.value.trim();
        const program = editProgram.value.trim();
        const yearLevel = editYearLevel.value.trim();

        if (!name || !newPhone) {
            alert("Please complete your name and contact number.");
            return;
        }

        if (!PHONE_PATTERN.test(newPhone)) {
            alert("Please enter a valid contact number.");
            return;
        }

        setSaving(personalForm, true);

        try {

            const changes = { fullName: name, phone: newPhone, program, yearLevel };

            // Remove older field names so they can't override the new values
            const cleanup = { course: null, year: null };

            await update(ref(db, PROFILE_PATH(currentUser.uid)), { ...changes, ...cleanup });

            const merged = { ...currentData, ...changes };
            delete merged.course;
            delete merged.year;
            renderProfile(merged, currentUser);

            closeModal(personalModal);
            alert("Personal information updated successfully.");

        } catch (error) {

            console.error("Personal info update error:", error);
            alert("Unable to update personal information.");

        } finally {

            setSaving(personalForm, false);
        }
    });


    /* =========================================
       SAVE EMERGENCY CONTACT
    ========================================= */

    emergencyForm.addEventListener("submit", async (event) => {

        event.preventDefault();

        if (!currentUser) {
            alert("You are not logged in.");
            return;
        }

        const emergencyName = editEmergencyName.value.trim();
        const relationship = editRelationship.value.trim();
        const emergencyPhone = editEmergencyPhone.value.trim();

        if ((emergencyName || emergencyPhone || relationship) && (!emergencyName || !emergencyPhone)) {
            alert("Please enter both the emergency contact's name and number.");
            return;
        }

        if (emergencyPhone && !PHONE_PATTERN.test(emergencyPhone)) {
            alert("Please enter a valid emergency contact number.");
            return;
        }

        setSaving(emergencyForm, true);

        try {

            const changes = { emergencyName, relationship, emergencyPhone };

            await update(ref(db, PROFILE_PATH(currentUser.uid)), { ...changes, emergencyContact: null });

            const merged = { ...currentData, ...changes };
            delete merged.emergencyContact;
            renderProfile(merged, currentUser);

            closeModal(emergencyModal);
            alert("Emergency contact updated successfully.");

        } catch (error) {

            console.error("Emergency contact update error:", error);
            alert("Unable to update emergency contact.");

        } finally {

            setSaving(emergencyForm, false);
        }
    });


    /* =========================================
       LOGOUT (desktop + mobile)
    ========================================= */

    async function handleLogout(event) {

        if (event) event.preventDefault();

        if (!confirm("Are you sure you want to log out?")) return;

        try {
            await signOut(auth);
            sessionStorage.clear();
            window.location.href = "../login/login.html";
        } catch (error) {
            console.error("Logout error:", error);
            alert("Unable to log out.");
        }
    }

    [$("logoutBtn"), $("mobileLogoutBtn")].forEach((btn) => {
        if (btn) btn.addEventListener("click", handleLogout);
    });


    /* =========================================
       PROFILE PHOTO
    ========================================= */

    const avatarEdit = $("avatarEdit");

    if (avatarEdit) {
        avatarEdit.addEventListener("click", () => {
            alert("Profile photo upload can be connected to Firebase Storage.");
        });
    }

});