// ==========================================
// ADMIN: oversee all student and employee appointments
// ==========================================
import { auth, db } from "../firebase/firebase.js";

import {
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

import {
    ref,
    get,
    update,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";


document.addEventListener("DOMContentLoaded", () => {

    /* =========================================
       SETTINGS (keep in sync with appointments.js)
    ========================================= */

    const SLOT_MINUTES = 30;
    const REFRESH_MS = 60000;   // quiet auto-refresh so new bookings appear

    const SERVICES = {
        consultation: "Medical Consultation",
        dental: "Dental Services",
        certificate: "Medical Certificate"
    };

    // The hard-coded admin account (Firebase Console > Authentication > User UID)
    const ADMIN_UID = "dMcFELN1ildDnJL4AEwUxAq0SLE2";


    /* =========================================
       HELPERS
    ========================================= */

    const $ = (id) => document.getElementById(id);

    const pad = (n) => String(n).padStart(2, "0");

    const toDateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    function parseDateKey(key) {
        const [y, m, d] = key.split("-").map(Number);
        return new Date(y, m - 1, d);
    }

    function toMinutes(time) {
        const [h, m] = time.split(":").map(Number);
        return h * 60 + m;
    }

    const toTime = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

    function formatTime(time) {
        const [h, m] = time.split(":").map(Number);
        return `${h % 12 || 12}:${pad(m)} ${h >= 12 ? "PM" : "AM"}`;
    }

    const slotKey = (time) => time.replace(":", "");

    function slotDate(dateKey, time) {
        const [h, m] = time.split(":").map(Number);
        const when = parseDateKey(dateKey);
        when.setHours(h, m, 0, 0);
        return when;
    }

    const formatDateLong = (key) =>
        parseDateKey(key).toLocaleDateString("en-US", {
            weekday: "long", month: "long", day: "numeric", year: "numeric"
        });

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, (c) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[c]));
    }

    function toast(message, type = "info") {
        const el = document.createElement("div");
        el.className = `toast ${type}`;
        el.textContent = message;
        $("toasts").appendChild(el);

        setTimeout(() => el.remove(), 4500);
    }

    // Older or hand-made records may use different field names.
    // Anything missing from the appointment is filled in from the
    // student / employee record (matched by the appointment's uid).
    const profileOf = (a) => profiles[a.uid] || {};
    const patientName = (a) => a.patientName || a.studentName || a.employeeName || profileOf(a).fullName || profileOf(a).name || "Unknown patient";
    const patientId = (a) => a.patientId || a.studentId || a.employeeId || profileOf(a).studentId || profileOf(a).employeeId || "";
    const patientPhone = (a) => a.patientPhone || a.studentPhone || profileOf(a).phone || "";
    const patientEmail = (a) => a.patientEmail || profileOf(a).email || "";
    const patientRole = (a) => ((a.patientRole || profileOf(a).role) === "employee" ? "employee" : "student");
    const patientDetail = (a) => {
        const p = profileOf(a);
        return patientRole(a) === "student"
            ? [p.program, p.yearLevel].filter(Boolean).join(" · ")
            : (p.department || "");
    };
    const statusOf = (a) => String(a.status || "pending").toLowerCase();
    const whenOf = (a) => (a.date && a.time ? slotDate(a.date, a.time) : new Date(0));
    const serviceName = (a) => SERVICES[a.service] || a.serviceName || "Appointment";


    /* =========================================
       STATE
    ========================================= */

    let adminUser = null;
    let adminName = "";

    let all = [];
    let profiles = {};         // uid -> student / employee record
    let loaded = false;
    let busy = false;          // an action is being saved

    // CHANGED: range now starts on "all" so every appointment is shown
    const filters = { range: "all", status: "all", service: "all", role: "all", search: "" };

    let pendingCancel = null;


    /* =========================================
       LOAD
    ========================================= */

    async function loadAppointments(quiet = false) {

        if (!adminUser) return;

        try {

            const [apptSnap, studentSnap, employeeSnap] = await Promise.all([
                get(ref(db, "appointments")),
                get(ref(db, "students")),
                get(ref(db, "employees"))
            ]);

            profiles = {};

            Object.entries(studentSnap.exists() ? studentSnap.val() : {}).forEach(([uid, p]) => {
                profiles[uid] = { ...p, role: "student" };
            });

            Object.entries(employeeSnap.exists() ? employeeSnap.val() : {}).forEach(([uid, p]) => {
                profiles[uid] = { ...p, role: "employee" };
            });

            all = apptSnap.exists()
                ? Object.entries(apptSnap.val()).map(([id, value]) => ({ id, ...value }))
                : [];

            loaded = true;

        } catch (error) {

            console.error("Failed to load appointments:", error);

            if (!quiet || !loaded) {
                $("appointmentList").innerHTML = `
                    <div class="empty-state">
                        <h4>We couldn't load the appointments</h4>
                        <p>Check your connection and permissions, then try again.</p>
                        <button type="button" class="btn-primary" id="retryBtn">Try again</button>
                    </div>
                `;
                $("resultCount").textContent = "";
            }

            return;
        }

        render();
    }


    /* =========================================
       FILTER + RENDER
    ========================================= */

    function filtered() {

        const today = toDateKey(new Date());
        const term = filters.search.trim().toLowerCase();

        return all.filter((a) => {

            const date = a.date || "";

            if (filters.range === "today" && date !== today) return false;
            if (filters.range === "upcoming" && date < today) return false;
            if (filters.range === "past" && date >= today) return false;

            if (filters.status !== "all" && statusOf(a) !== filters.status) return false;
            if (filters.service !== "all" && a.service !== filters.service) return false;
            if (filters.role !== "all" && patientRole(a) !== filters.role) return false;

            if (term) {
                const haystack = `${patientName(a)} ${patientId(a)} ${serviceName(a)}`.toLowerCase();
                if (!haystack.includes(term)) return false;
            }

            return true;
        });
    }

    function sortList(list) {

        // Today / upcoming: soonest first. Past / all: newest first.
        const newestFirst = filters.range === "past" || filters.range === "all";

        return list.sort((a, b) => newestFirst
            ? whenOf(b) - whenOf(a)
            : whenOf(a) - whenOf(b));
    }

    function renderStats() {

        const today = toDateKey(new Date());

        $("statToday").textContent = all.filter((a) => a.date === today && statusOf(a) !== "cancelled").length;
        $("statPending").textContent = all.filter((a) => statusOf(a) === "pending" && (a.date || "") >= today).length;
        $("statConfirmed").textContent = all.filter((a) => statusOf(a) === "confirmed" && (a.date || "") >= today).length;
        $("statCompleted").textContent = all.filter((a) => statusOf(a) === "completed").length;
    }

    const BADGES = {
        pending: "Pending",
        confirmed: "Confirmed",
        completed: "Completed",
        missed: "Missed",
        cancelled: "Cancelled"
    };

    // Which buttons make sense for this appointment right now
    function actionsFor(a) {

        const status = statusOf(a);
        const now = new Date();
        const started = whenOf(a) <= now;
        const todayOrEarlier = (a.date || "") <= toDateKey(now);

        if (status === "pending") {
            return started
                ? ["missed", "cancel"]
                : ["confirm", "cancel"];
        }

        if (status === "confirmed") {
            const actions = [];
            if (todayOrEarlier) actions.push("complete");
            actions.push(started ? "missed" : "cancel");
            return actions;
        }

        return [];
    }

    const ACTION_BUTTONS = {
        confirm:  '<button type="button" class="link-btn primary" data-action="confirm" data-id="__ID__">Confirm</button>',
        complete: '<button type="button" class="link-btn success" data-action="complete" data-id="__ID__">Mark completed</button>',
        missed:   '<button type="button" class="link-btn" data-action="missed" data-id="__ID__">Mark missed</button>',
        cancel:   '<button type="button" class="link-btn danger" data-action="cancel" data-id="__ID__">Cancel</button>'
    };

    function card(a) {

        const status = statusOf(a);
        const phone = patientPhone(a);
        const id = patientId(a);
        const role = patientRole(a);
        const email = patientEmail(a);
        const detail = patientDetail(a);

        const end = a.time ? formatTime(toTime(toMinutes(a.time) + SLOT_MINUTES)) : "";

        const buttons = actionsFor(a)
            .map((action) => ACTION_BUTTONS[action].replace("__ID__", escapeHtml(a.id)))
            .join("");

        return `
            <article class="appt-card">
                <div class="appt-time">
                    ${a.time ? formatTime(a.time) : "--"}
                    <small>${end ? `until ${end}` : ""}</small>
                </div>

                <div class="appt-info">
                    <h4>${escapeHtml(patientName(a))}</h4>

                    <div class="appt-meta">
                        <span class="type-chip ${role}">${role}</span>
                        ${id ? `<span>${escapeHtml(id)}</span>` : ""}
                        ${detail ? `<span>${escapeHtml(detail)}</span>` : ""}
                        <span>${escapeHtml(serviceName(a))}</span>
                        ${phone ? `<a href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a>` : ""}
                        ${email ? `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>` : ""}
                    </div>

                    ${a.reason ? `<p class="appt-reason">${escapeHtml(a.reason)}</p>` : ""}
                    ${a.clinicNote ? `<p class="appt-reason"><strong>Note sent:</strong> ${escapeHtml(a.clinicNote)}</p>` : ""}
                    ${a.handledByName ? `<p class="appt-handled">Last updated by ${escapeHtml(a.handledByName)}</p>` : ""}
                </div>

                <div class="appt-side">
                    <span class="badge ${status}">${BADGES[status] || escapeHtml(status)}</span>
                    ${buttons ? `<div class="appt-actions">${buttons}</div>` : ""}
                </div>
            </article>
        `;
    }

    function render() {

        if (!loaded) return;

        renderStats();

        const list = sortList(filtered());

        $("resultCount").textContent =
            `Showing ${list.length} of ${all.length} appointment${all.length === 1 ? "" : "s"}`;

        if (list.length === 0) {
            $("appointmentList").innerHTML = `
                <div class="empty-state">
                    <h4>No appointments found</h4>
                    <p>Try a different date range or clear the filters.</p>
                </div>
            `;
            return;
        }

        // Group by date
        const groups = new Map();

        list.forEach((a) => {
            const key = a.date || "none";
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(a);
        });

        const today = toDateKey(new Date());
        const tomorrowDate = new Date();
        tomorrowDate.setDate(tomorrowDate.getDate() + 1);
        const tomorrow = toDateKey(tomorrowDate);

        $("appointmentList").innerHTML = [...groups.entries()].map(([key, items]) => {

            const label = key === "none"
                ? "No date"
                : (key === today ? "Today · " : key === tomorrow ? "Tomorrow · " : "") + formatDateLong(key);

            return `
                <section class="day-group">
                    <div class="day-heading">
                        <h3>${label}</h3>
                        <span>${items.length} appointment${items.length === 1 ? "" : "s"}</span>
                    </div>
                    <div class="appointment-list">${items.map(card).join("")}</div>
                </section>
            `;
        }).join("");
    }


    /* =========================================
       FILTER CONTROLS
    ========================================= */

    $("rangeFilters").addEventListener("click", (event) => {

        const button = event.target.closest(".filter");
        if (!button) return;

        filters.range = button.dataset.range;

        document.querySelectorAll("#rangeFilters .filter").forEach((b) => {
            b.classList.toggle("active", b === button);
        });

        render();
    });

    $("statusFilter").addEventListener("change", (e) => { filters.status = e.target.value; render(); });
    $("serviceFilter").addEventListener("change", (e) => { filters.service = e.target.value; render(); });
    $("roleFilter").addEventListener("change", (e) => { filters.role = e.target.value; render(); });
    $("searchInput").addEventListener("input", (e) => { filters.search = e.target.value; render(); });

    $("refreshBtn").addEventListener("click", async () => {
        await loadAppointments();
        toast("Appointments refreshed.");
    });


    /* =========================================
       ACTIONS: confirm / complete / missed / cancel
    ========================================= */

    async function setStatus(a, status, extra = {}, freeSlot = false) {

        if (busy) return false;

        busy = true;

        try {

            const changes = {
                [`appointments/${a.id}/status`]: status,
                [`appointments/${a.id}/handledBy`]: adminUser.uid,
                [`appointments/${a.id}/handledByName`]: adminName,
                [`appointments/${a.id}/handledAt`]: serverTimestamp()
            };

            Object.entries(extra).forEach(([field, value]) => {
                changes[`appointments/${a.id}/${field}`] = value;
            });

            // Cancelling releases the time so another patient can book it
            if (freeSlot && a.service && a.date && a.time) {
                changes[`slots/${a.date}/${a.service}/${slotKey(a.time)}`] = null;
            }

            await update(ref(db), changes);

            await loadAppointments(true);

            return true;

        } catch (error) {

            console.error("Update error:", error);
            toast("That change couldn't be saved. Please try again.", "error");

            return false;

        } finally {

            busy = false;
        }
    }

    $("appointmentList").addEventListener("click", async (event) => {

        if (event.target.closest("#retryBtn")) {
            loadAppointments();
            return;
        }

        const button = event.target.closest("[data-action]");

        if (!button) return;

        const a = all.find((item) => item.id === button.dataset.id);

        if (!a) return;

        const action = button.dataset.action;

        if (action === "cancel") {
            openCancelModal(a);
            return;
        }

        button.disabled = true;

        const messages = {
            confirm: ["confirmed", "Appointment confirmed."],
            complete: ["completed", "Marked as completed."],
            missed: ["missed", "Marked as missed."]
        };

        const [status, message] = messages[action];

        const saved = await setStatus(a, status);

        if (saved) toast(message, "success");
        else button.disabled = false;
    });


    /* =========================================
       CANCEL MODAL
    ========================================= */

    function openCancelModal(a) {

        pendingCancel = a;

        $("cancelDetail").innerHTML =
            `<strong>${escapeHtml(patientName(a))}</strong><br>` +
            `${escapeHtml(serviceName(a))} · ${a.date ? formatDateLong(a.date) : ""} at ${a.time ? formatTime(a.time) : ""}`;

        $("cancelNote").value = "";

        $("cancelModal").classList.add("show");
        $("cancelNote").focus();
    }

    function closeCancelModal() {
        $("cancelModal").classList.remove("show");
        pendingCancel = null;
    }

    $("cancelModalClose").addEventListener("click", closeCancelModal);
    $("cancelKeep").addEventListener("click", closeCancelModal);

    $("cancelModal").addEventListener("click", (event) => {
        if (event.target === $("cancelModal")) closeCancelModal();
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeCancelModal();
    });

    $("cancelConfirm").addEventListener("click", async () => {

        const a = pendingCancel;

        if (!a) return;

        $("cancelConfirm").disabled = true;

        const saved = await setStatus(a, "cancelled", {
            cancelledBy: "admin",
            cancelledAt: serverTimestamp(),
            clinicNote: $("cancelNote").value.trim()
        }, true);

        $("cancelConfirm").disabled = false;

        if (saved) {
            closeCancelModal();
            toast("Appointment cancelled. The time is open again.", "success");
        }
    });


    /* =========================================
       EXPORT CSV (whatever the filters currently show)
    ========================================= */

    // Stops spreadsheet apps from running text that starts with = + - @ as a formula
    function csvCell(value) {

        let text = String(value ?? "");

        if (/^[=+\-@]/.test(text)) text = "'" + text;

        return `"${text.replace(/"/g, '""')}"`;
    }

    $("exportBtn").addEventListener("click", () => {

        const list = sortList(filtered());

        if (list.length === 0) {
            toast("There is nothing to export for the current filters.", "error");
            return;
        }

        const header = ["Date", "Time", "Service", "Patient", "Type", "ID", "Program / Department", "Email", "Phone", "Status", "Reason", "Note"];

        const rows = list.map((a) => [
            a.date || "",
            a.time ? formatTime(a.time) : "",
            serviceName(a),
            patientName(a),
            patientRole(a),
            patientId(a),
            patientDetail(a),
            patientEmail(a),
            patientPhone(a),
            BADGES[statusOf(a)] || statusOf(a),
            a.reason || "",
            a.clinicNote || ""
        ]);

        const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");

        // BOM so Excel reads accented names correctly
        const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = url;
        link.download = `appointments-${toDateKey(new Date())}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(() => URL.revokeObjectURL(url), 1000);

        toast(`Exported ${list.length} appointment${list.length === 1 ? "" : "s"}.`, "success");
    });


    /* =========================================
       LOGOUT
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
            toast("Unable to log out.", "error");
        }
    }

    [$("logoutBtn"), $("mobileLogoutBtn")].forEach((button) => {
        if (button) button.addEventListener("click", handleLogout);
    });


    /* =========================================
       AUTHENTICATION: admin only
    ========================================= */

    onAuthStateChanged(auth, async (user) => {

        if (!user) {
            window.location.href = "../login/login.html";
            return;
        }

        // Only the hard-coded admin account may use this page
        if (user.uid !== ADMIN_UID) {

            let isEmployee = false;

            try {
                const snap = await get(ref(db, `employees/${user.uid}`));
                isEmployee = snap.exists();
            } catch (error) {
                console.warn("Could not check account type:", error);
            }

            window.location.replace(isEmployee ? "../dashboard/em-appointment.html" : "../dashboard/st-appointment.html");
            return;
        }

        adminUser = user;
        adminName = user.displayName || user.email || "Admin";

        $("accessCheck").hidden = true;
        $("adminContent").hidden = false;

        await loadAppointments();

        // Quiet refresh so new bookings show up without reloading
        setInterval(() => {
            if (!document.hidden && !busy && !$("cancelModal").classList.contains("show")) {
                loadAppointments(true);
            }
        }, REFRESH_MS);
    });

});