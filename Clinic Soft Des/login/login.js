/* ============================================================
   NUFV CARES LOGIN
   ============================================================ */

const loginForm = document.getElementById("loginForm");

const loginRole = document.getElementById("loginRole");
const loginUsername = document.getElementById("loginUsername");
const loginPassword = document.getElementById("loginPassword");

const loginRoleError = document.getElementById("loginRoleError");
const loginUsernameError = document.getElementById("loginUsernameError");
const loginPasswordError = document.getElementById("loginPasswordError");

const loginMessage = document.getElementById("loginMessage");


/* ============================================================
   LOGIN FORM
   ============================================================ */

loginForm.addEventListener("submit", function (event) {

    event.preventDefault();


    /* ========================================================
       GET VALUES
    ======================================================== */

    const role = loginRole.value;
    const username = loginUsername.value.trim();
    const password = loginPassword.value;


    /* ========================================================
       CLEAR PREVIOUS VALIDATION
    ======================================================== */

    loginRoleError.textContent = "";
    loginUsernameError.textContent = "";
    loginPasswordError.textContent = "";

    loginMessage.textContent = "";
    loginMessage.className = "";

    loginRole.classList.remove(
        "error-border",
        "success-border"
    );

    loginUsername.classList.remove(
        "error-border",
        "success-border"
    );

    loginPassword.classList.remove(
        "error-border",
        "success-border"
    );


    let valid = true;


    /* ========================================================
       ACCOUNT TYPE VALIDATION
    ======================================================== */

    if (role === "") {

        loginRoleError.textContent =
            "Please select an account type.";

        loginRole.classList.add("error-border");

        valid = false;

    } else {

        loginRole.classList.add("success-border");

    }


    /* ========================================================
       USERNAME VALIDATION
    ======================================================== */

    if (username === "") {

        loginUsernameError.textContent =
            "Username is required.";

        loginUsername.classList.add("error-border");

        valid = false;

    } else {

        loginUsername.classList.add("success-border");

    }


    /* ========================================================
       PASSWORD VALIDATION
    ======================================================== */

    if (password === "") {

        loginPasswordError.textContent =
            "Password is required.";

        loginPassword.classList.add("error-border");

        valid = false;

    } else {

        loginPassword.classList.add("success-border");

    }


    /* ========================================================
       AUTHENTICATION
    ======================================================== */

    if (valid) {

        /*
           TEMPORARY LOGIN CREDENTIALS

           Replace this later with your database/backend
           authentication.
        */

        const correctUsername = "admin";
        const correctPassword = "12345678";


        if (
            username === correctUsername &&
            password === correctPassword
        ) {

            loginMessage.textContent =
                "Login successful!";

            loginMessage.style.color =
                "#28a745";


            /*
               Redirect to dashboard
            */

            setTimeout(() => {

                window.location.href =
                    "../dashboard/dashboard.html";

            }, 500);


        } else {

            loginMessage.textContent =
                "Invalid username or password.";

            loginMessage.className =
                "login-error";


            loginUsername.classList.add(
                "error-border"
            );

            loginPassword.classList.add(
                "error-border"
            );

        }

    }

});


/* ============================================================
   SHOW / HIDE PASSWORD
   ============================================================ */

const toggleLoginPassword =
    document.getElementById(
        "toggleLoginPassword"
    );


if (
    toggleLoginPassword &&
    loginPassword
) {

    toggleLoginPassword.addEventListener(
        "click",
        function () {

            if (
                loginPassword.type ===
                "password"
            ) {

                loginPassword.type =
                    "text";

                this.classList.remove(
                    "fa-eye"
                );

                this.classList.add(
                    "fa-eye-slash"
                );

            } else {

                loginPassword.type =
                    "password";

                this.classList.remove(
                    "fa-eye-slash"
                );

                this.classList.add(
                    "fa-eye"
                );

            }

        }
    );

}


/* ============================================================
   INPUT INTERACTION
   ============================================================ */

const inputs = [
    loginRole,
    loginUsername,
    loginPassword
];


inputs.forEach((input) => {

    input.addEventListener(
        "input",
        function () {

            this.classList.remove(
                "error-border"
            );

        }
    );

});