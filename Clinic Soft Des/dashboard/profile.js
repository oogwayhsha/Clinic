import { auth, db } from "../firebase/firebase.js";

import {
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

import {
    ref,
    get,
    update
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";


document.addEventListener("DOMContentLoaded", () => {


    /* =========================================
       ELEMENTS
    ========================================= */

    const modal =
        document.getElementById("profileModal");

    const editButton =
        document.getElementById("editPersonalBtn");

    const closeButton =
        document.getElementById("modalClose");

    const cancelButton =
        document.getElementById("cancelBtn");

    const form =
        document.getElementById("profileForm");


    const fullName =
        document.getElementById("fullName");

    const email =
        document.getElementById("email");

    const phone =
        document.getElementById("phone");


    const summaryName =
        document.getElementById("summaryName");

    const summaryId =
        document.getElementById("summaryId");

    const avatar =
        document.getElementById("avatar");


    const editName =
        document.getElementById("editName");

    const editEmail =
        document.getElementById("editEmail");

    const editPhone =
        document.getElementById("editPhone");


    const logoutBtn =
        document.getElementById("logoutBtn");


    /* =========================================
       INITIALS
    ========================================= */

    function getInitials(name) {

        return name
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map(part =>
                part.charAt(0).toUpperCase()
            )
            .join("");

    }


    /* =========================================
       LOAD PROFILE
    ========================================= */

    async function loadProfile(uid) {

        try {

            const userRef =
                doc(db, "users", uid);


            const userSnapshot =
                await getDoc(userRef);


            if (!userSnapshot.exists()) {

                alert(
                    "Your profile information was not found."
                );

                return;

            }


            const student =
                userSnapshot.data();


            /* PERSONAL INFORMATION */

            fullName.textContent =
                student.fullName || "Not provided";


            summaryName.textContent =
                student.fullName || "Student";


            summaryId.textContent =
                student.studentId || "Not provided";


            document.getElementById("studentId")
                .textContent =
                student.studentId || "Not provided";


            email.textContent =
                student.email || "Not provided";


            phone.textContent =
                student.phone || "Not provided";


            document.getElementById("program")
                .textContent =
                student.program || "Not provided";


            document.getElementById("yearLevel")
                .textContent =
                student.yearLevel || "Not provided";


            /* EMERGENCY CONTACT */

            document.getElementById("emergencyName")
                .textContent =
                student.emergencyName || "Not provided";


            document.getElementById("relationship")
                .textContent =
                student.relationship || "Not provided";


            document.getElementById("emergencyPhone")
                .textContent =
                student.emergencyPhone || "Not provided";


            /* AVATAR */

            avatar.textContent =
                getInitials(
                    student.fullName || "Student"
                );


            /* APPOINTMENT COUNT */

            document.getElementById("appointmentCount")
                .textContent =
                student.appointmentCount || 0;


            document.getElementById("completedCount")
                .textContent =
                student.completedAppointments || 0;


            /* EDIT FORM */

            editName.value =
                student.fullName || "";


            editEmail.value =
                student.email || "";


            editPhone.value =
                student.phone || "";


        } catch (error) {

            console.error(
                "Error loading profile:",
                error
            );

            alert(
                "Unable to load your profile."
            );

        }

    }


    /* =========================================
       CHECK AUTHENTICATION
    ========================================= */

onAuthStateChanged(auth, async (user) => {

    if (!user) {
        window.location.href = "../login/login.html";
        return;
    }

    try {

        const userRef = ref(db, `users/${user.uid}`);
        const snapshot = await get(userRef);

        if (!snapshot.exists()) {
            console.error("No profile found for:", user.uid);
            alert("Failed to load profile.");
            return;
        }

        const userData = snapshot.val();

        console.log("Profile loaded:", userData);

        document.getElementById("fullName").textContent =
            userData.fullName || "Not provided";

        document.getElementById("studentId").textContent =
            userData.studentId || "Not provided";

        document.getElementById("email").textContent =
            userData.email || user.email;

        document.getElementById("program").textContent =
            userData.program || "Not provided";

        document.getElementById("yearLevel").textContent =
            userData.yearLevel || "Not provided";

    } catch (error) {

        console.error("Failed to load profile:", error);

        alert("Failed to load profile: " + error.message);
    }
});


    /* =========================================
       OPEN MODAL
    ========================================= */

    editButton.addEventListener(
        "click",
        () => {

            modal.classList.add("show");

            editName.focus();

        }
    );


    /* =========================================
       CLOSE MODAL
    ========================================= */

    function closeModal() {

        modal.classList.remove("show");

    }


    closeButton.addEventListener(
        "click",
        closeModal
    );


    cancelButton.addEventListener(
        "click",
        closeModal
    );


    /* CLOSE WHEN CLICKING OUTSIDE */

    modal.addEventListener(
        "click",
        (event) => {

            if (
                event.target === modal
            ) {

                closeModal();

            }

        }
    );


    /* ESC KEY */

    document.addEventListener(
        "keydown",
        (event) => {

            if (
                event.key === "Escape"
            ) {

                closeModal();

            }

        }
    );


    /* =========================================
       UPDATE PROFILE
    ========================================= */

    form.addEventListener(
        "submit",
        async (event) => {

            event.preventDefault();


            const user =
                auth.currentUser;


            if (!user) {

                alert(
                    "You are not logged in."
                );

                return;

            }


            const name =
                editName.value.trim();


            const newEmail =
                editEmail.value.trim();


            const newPhone =
                editPhone.value.trim();


            if (
                !name ||
                !newEmail ||
                !newPhone
            ) {

                alert(
                    "Please complete all fields."
                );

                return;

            }


            try {

                const userRef =
                    doc(
                        db,
                        "users",
                        user.uid
                    );


                await updateDoc(
                    userRef,
                    {

                        fullName: name,

                        email: newEmail,

                        phone: newPhone

                    }
                );


                /* UPDATE PAGE */

                fullName.textContent =
                    name;


                summaryName.textContent =
                    name;


                email.textContent =
                    newEmail;


                phone.textContent =
                    newPhone;


                avatar.textContent =
                    getInitials(name);


                closeModal();


                alert(
                    "Profile updated successfully."
                );


            } catch (error) {

                console.error(
                    "Profile update error:",
                    error
                );


                alert(
                    "Unable to update profile."
                );

            }

        }
    );


    /* =========================================
       LOGOUT
    ========================================= */

    if (logoutBtn) {

        logoutBtn.addEventListener(
            "click",
            async () => {

                try {

                    await signOut(auth);


                    window.location.href =
                        "../login/login.html";


                } catch (error) {

                    console.error(
                        "Logout error:",
                        error
                    );


                    alert(
                        "Unable to logout."
                    );

                }

            }
        );

    }


    /* =========================================
       NOTIFICATION SETTINGS
    ========================================= */

    const notificationInputs = [

        document.getElementById(
            "appointmentReminder"
        ),

        document.getElementById(
            "scheduleUpdates"
        )

    ];


    notificationInputs.forEach(
        (input) => {

            if (!input) return;


            const saved =
                localStorage.getItem(
                    input.id
                );


            if (saved !== null) {

                input.checked =
                    saved === "true";

            }


            input.addEventListener(
                "change",
                () => {

                    localStorage.setItem(
                        input.id,
                        input.checked
                    );

                }
            );

        }
    );


    /* =========================================
       PROFILE PHOTO
    ========================================= */

    const avatarEdit =
        document.getElementById(
            "avatarEdit"
        );


    if (avatarEdit) {

        avatarEdit.addEventListener(
            "click",
            () => {

                alert(
                    "Profile photo upload can be connected to Firebase Storage."
                );

            }
        );

    }

});