import { auth, db } from "../../Software Activity/Login/firebase/firebase.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  ref,
  get
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

document.addEventListener("DOMContentLoaded", () => {

    const modal = document.getElementById("profileModal");
    const editButton = document.getElementById("editPersonalBtn");
    const closeButton = document.getElementById("modalClose");
    const cancelButton = document.getElementById("cancelBtn");
    const form = document.getElementById("profileForm");

    const fullName = document.getElementById("fullName");
    const email = document.getElementById("email");
    const phone = document.getElementById("phone");

    const summaryName = document.getElementById("summaryName");
    const avatar = document.getElementById("avatar");

    const editName = document.getElementById("editName");
    const editEmail = document.getElementById("editEmail");
    const editPhone = document.getElementById("editPhone");


    // =========================
    // GET USER INITIALS
    // =========================

    function getInitials(name) {

        return name
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map(part => part.charAt(0).toUpperCase())
            .join("");

    }


    // =========================
    // OPEN EDIT PROFILE MODAL
    // =========================

    function openModal() {

        editName.value = fullName.textContent;
        editEmail.value = email.textContent;
        editPhone.value = phone.textContent;

        modal.classList.add("show");

        editName.focus();

    }


    // =========================
    // CLOSE MODAL
    // =========================

    function closeModal() {

        modal.classList.remove("show");

    }


    // =========================
    // EDIT BUTTON
    // =========================

    editButton.addEventListener("click", openModal);


    // =========================
    // CLOSE BUTTON
    // =========================

    closeButton.addEventListener("click", closeModal);

    cancelButton.addEventListener("click", closeModal);


    // =========================
    // CLOSE WHEN CLICKING OUTSIDE
    // =========================

    modal.addEventListener("click", (event) => {

        if (event.target === modal) {

            closeModal();

        }

    });


    // =========================
    // ESC KEY CLOSE
    // =========================

    document.addEventListener("keydown", (event) => {

        if (event.key === "Escape") {

            closeModal();

        }

    });


    // =========================
    // SAVE PROFILE
    // =========================

    form.addEventListener("submit", (event) => {

        event.preventDefault();

        const name = editName.value.trim();
        const newEmail = editEmail.value.trim();
        const newPhone = editPhone.value.trim();


        // Make sure fields aren't empty

        if (!name || !newEmail || !newPhone) {

            alert("Please complete all fields.");

            return;

        }


        // Update profile information

        fullName.textContent = name;

        email.textContent = newEmail;

        phone.textContent = newPhone;


        // Update profile card

        summaryName.textContent = name;

        avatar.textContent = getInitials(name);


        // Close modal

        closeModal();


        // Confirmation

        alert("Profile information updated successfully.");

    });


    // =========================
    // NOTIFICATION SETTINGS
    // =========================

    const notificationInputs = [

        document.getElementById("appointmentReminder"),

        document.getElementById("scheduleUpdates")

    ];


    notificationInputs.forEach((input) => {

        if (!input) return;


        // Load saved setting

        const saved = localStorage.getItem(input.id);


        if (saved !== null) {

            input.checked = saved === "true";

        }


        // Save setting

        input.addEventListener("change", () => {

            localStorage.setItem(

                input.id,

                input.checked

            );

        });

    });


    // =========================
    // PROFILE PHOTO BUTTON
    // =========================

    const avatarEdit = document.getElementById("avatarEdit");


    if (avatarEdit) {

        avatarEdit.addEventListener("click", () => {

            alert(
                "Profile photo upload can be connected here when the system has a backend."
            );

        });

    }

});