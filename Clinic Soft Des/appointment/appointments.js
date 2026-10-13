// ==========================================
// APPOINTMENTS PAGE: book + manage appointments
// (with appointment history)
// ==========================================
import { auth, db } from "../firebase/firebase.js";

import {
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

import {
    ref,
    get,
    push,
    update,
    query,
    orderByChild,
    equalTo,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";


document.addEventListener("DOMContentLoaded", () => {

    /* =========================================
       SETTINGS
       Keep these in sync with the Schedule section
       of dashboard.html (Service Availability).
       days: 0 = Sunday ... 6 = Saturday
       ranges: 24-hour start/end of bookable time
    ========================================= */

    // This page is used by students (st-appointment.html) and employees (em-appointment.html).
    // <body data-role="student|employee"> decides which one.
    const PAGE_ROLE = document.body.dataset.role === "employee" ? "employee" : "student";

    const ROLE = {
        student:  { idField: "studentId",  label: "Student",  other: "st-appointment.html" },
        employee: { idField: "employeeId", label: "Employee", other: "em-appointment.html" }
    }[PAGE_ROLE];

    // The hard-coded admin account (Firebase Console > Authentication > User UID)
    const ADMIN_UID = "dMcFELN1ildDnJL4AEwUxAq0SLE2";

    const SLOT_MINUTES = 30;          // length of one appointment
    const BOOKING_WINDOW_DAYS = 14;   // how far ahead students can book
    const MAX_REASON = 300;

    const SERVICES = {
        consultation: {
            name: "Medical Consultation",
            desc: "See a physician for check-ups, illness and other health concerns.",
            color: "blue",
            days: [1, 2, 3, 4, 5],
            ranges: [["08:00", "16:30"]],
            icon: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>'
        },
        dental: {
            name: "Dental Services",
            desc: "Dental check-ups, cleaning and basic oral care.",
            color: "teal",
            days: [1, 3, 5],
            ranges: [["09:00", "16:00"]],
            icon: '<path d="M7 4c-2.2 0-4 1.8-4 4.2 0 1.7.6 2.8 1.1 4.3C4.6 14.4 5 20 7 20c1.6 0 1.5-4 3-4h4c1.5 0 1.4 4 3 4 2 0 2.4-5.6 2.9-7.5.5-1.5 1.1-2.6 1.1-4.3C21 5.8 19.2 4 17 4c-1.5 0-2.5 1-5 1S8.5 4 7 4z"></path>'
        },
        certificate: {
            name: "Medical Certificate",
            desc: "Request health clearances and medical certificates.",
            color: "orange",
            days: [1, 2, 3, 4, 5],
            ranges: [["08:00", "11:00"], ["13:00", "16:00"]],
            icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><polyline points="9 15 11 17 15 13"></polyline>'
        }
    };

    const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    // Text shown in the history timeline for each recorded action
    const HISTORY_LABEL = {
        booked:    "Appointment booked",
        confirmed: "Approved by the clinic",
        cancelled: "Cancelled",
        completed: "Completed",
        missed:    "Marked as missed"
    };


    /* =========================================
       HELPERS
    ========================================= */

    const $ = (id) => document.getElementById(id);

    const pad = (n) => String(n).padStart(2, "0");

    // Local date as YYYY-MM-DD (never use toISOString: it shifts the day in UTC)
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

    const formatDateLong = (key) =>
        parseDateKey(key).toLocaleDateString("en-US", {
            weekday: "long", month: "long", day: "numeric", year: "numeric"
        });

    // Realtime Database keys can't contain ":" in some tools, so store 0830
    const slotKey = (time) => time.replace(":", "");

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, (c) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[c]));
    }

    function generateSlots(service) {
        const slots = [];

        service.ranges.forEach(([start, end]) => {
            for (let m = toMinutes(start); m + SLOT_MINUTES <= toMinutes(end); m += SLOT_MINUTES) {
                slots.push(toTime(m));
            }
        });

        return slots;
    }

    function slotDate(dateKey, time) {
        const [h, m] = time.split(":").map(Number);
        const when = parseDateKey(dateKey);
        when.setHours(h, m, 0, 0);
        return when;
    }

    const isSlotPast = (dateKey, time) => slotDate(dateKey, time) <= new Date();

    const hasFutureSlot = (service, dateKey) =>
        generateSlots(service).some((time) => !isSlotPast(dateKey, time));

    function describeDays(days) {
        const sorted = [...days].sort((a, b) => a - b);
        const consecutive = sorted.length > 2 &&
            sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);

        return consecutive
            ? `${DAY_NAMES[sorted[0]]} – ${DAY_NAMES[sorted[sorted.length - 1]]}`
            : sorted.map((d) => DAY_NAMES[d]).join(", ");
    }

    function describeHours(service) {
        return service.ranges
            .map(([start, end]) => `${formatTime(start)} – ${formatTime(end)}`)
            .join(", ");
    }

    function toast(message, type = "info") {
        const el = document.createElement("div");
        el.className = `toast ${type}`;
        el.textContent = message;
        $("toasts").appendChild(el);

        setTimeout(() => el.remove(), 4500);
    }


    /* =========================================
       STATE
    ========================================= */

    let currentUser = null;
    let patientLabel = "";
    let patientId = "";
    let patientPhone = "";

    let myAppointments = [];
    let appointmentsLoaded = false;
    let activeFilter = "upcoming";
    let highlightId = null;

    const state = {
        service: "",
        date: "",
        time: "",
        taken: new Set(),
        loadingSlots: false,
        submitting: false
    };

    let slotRequest = 0;       // ignores out-of-date availability responses
    let pendingCancel = null;  // appointment waiting for cancel confirmation


    /* =========================================
       HISTORY
       Every change is recorded under
       appointments/{id}/history/{pushId}
       The clinic/admin side (Cloud Function) adds the
       "confirmed", "completed" and "missed" entries.
    ========================================= */

    const historyEntry = (action, status, note = "") => ({
        action,
        status,
        by: currentUser ? currentUser.uid : "",
        byRole: PAGE_ROLE,
        at: serverTimestamp(),
        note
    });

    function historyTimeline(a) {

        const items = Object.values(a.history || {})
            .sort((x, y) => (Number(x.at) || 0) - (Number(y.at) || 0));

        if (!items.length) return "";

        return `
            <ul class="history-list">
                ${items.map((h) => `
                    <li class="history-item ${escapeHtml(h.status || "")}">
                        <strong>${escapeHtml(HISTORY_LABEL[h.action] || h.action || "Updated")}</strong>
                        <span>${h.at ? new Date(Number(h.at)).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : ""}</span>
                        ${h.note ? `<em>${escapeHtml(h.note)}</em>` : ""}
                    </li>
                `).join("")}
            </ul>
        `;
    }


    /* =========================================
       TABS
    ========================================= */

    function showTab(name, updateUrl = true) {

        const isMine = name === "mine";

        $("panelBook").hidden = isMine;
        $("panelMine").hidden = !isMine;

        $("tabBook").classList.toggle("active", !isMine);
        $("tabMine").classList.toggle("active", isMine);

        $("tabBook").setAttribute("aria-selected", String(!isMine));
        $("tabMine").setAttribute("aria-selected", String(isMine));

        if (updateUrl) {
            try {
                history.replaceState(null, "", isMine ? "?tab=mine" : location.pathname);
            } catch (error) {
                /* history can be blocked in previews: safe to ignore */
            }
        }
    }

    $("tabBook").addEventListener("click", () => showTab("book"));
    $("tabMine").addEventListener("click", () => showTab("mine"));


    /* =========================================
       STEP 1: SERVICES
    ========================================= */

    function renderServices() {

        $("serviceOptions").innerHTML = Object.entries(SERVICES).map(([id, svc]) => `
            <button type="button"
                    class="service-option${state.service === id ? " selected" : ""}"
                    data-service="${id}"
                    aria-pressed="${state.service === id}">
                <span class="service-icon ${svc.color}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svc.icon}</svg>
                </span>
                <strong>${svc.name}</strong>
                <p>${svc.desc}</p>
                <span class="service-hours">${describeDays(svc.days)} · ${describeHours(svc)}</span>
            </button>
        `).join("");
    }

    $("serviceOptions").addEventListener("click", (event) => {
        const button = event.target.closest(".service-option");
        if (button) selectService(button.dataset.service);
    });

    function selectService(id) {

        if (!SERVICES[id]) return;

        state.service = id;
        state.date = "";
        state.time = "";
        state.taken = new Set();

        renderServices();
        renderDays();
        renderSlots();
        updateSummary();
    }


    /* =========================================
       STEP 2: DATES
    ========================================= */

    function renderDays() {

        const list = $("dayList");

        if (!state.service) {
            list.innerHTML = '<p class="hint">Choose a service first to see the dates available.</p>';
            return;
        }

        const service = SERVICES[state.service];

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let html = "";

        for (let i = 0; i < BOOKING_WINDOW_DAYS; i++) {

            const day = new Date(today);
            day.setDate(today.getDate() + i);

            const key = toDateKey(day);
            const open = service.days.includes(day.getDay()) && hasFutureSlot(service, key);
            const selected = key === state.date;

            const weekday = i === 0
                ? "Today"
                : day.toLocaleDateString("en-US", { weekday: "short" });

            const month = day.toLocaleDateString("en-US", { month: "short" });

            html += `
                <button type="button"
                        class="day-btn${selected ? " selected" : ""}"
                        data-date="${key}"
                        aria-pressed="${selected}"
                        ${open ? "" : 'disabled title="Not available"'}>
                    <span class="day-name">${weekday}</span>
                    <span class="day-num">${day.getDate()}</span>
                    <span class="day-month">${month}</span>
                </button>
            `;
        }

        list.innerHTML = html;
    }

    $("dayList").addEventListener("click", (event) => {
        const button = event.target.closest(".day-btn");
        if (button && !button.disabled) selectDate(button.dataset.date);
    });

    async function selectDate(key) {

        state.date = key;
        state.time = "";
        state.taken = new Set();
        state.loadingSlots = true;

        renderDays();
        renderSlots();
        updateSummary();

        const request = ++slotRequest;

        await loadTakenSlots();

        // A newer date/service was chosen while this was loading
        if (request !== slotRequest) return;

        state.loadingSlots = false;
        renderSlots();
    }

    async function loadTakenSlots() {

        try {

            const snapshot = await get(
                ref(db, `slots/${state.date}/${state.service}`)
            );

            state.taken = new Set(snapshot.exists() ? Object.keys(snapshot.val()) : []);

        } catch (error) {

            console.warn("Could not check live availability:", error);
            state.taken = new Set();

            toast("Couldn't check live availability. A taken time may be rejected when you confirm.", "error");
        }
    }


    /* =========================================
       STEP 3: TIMES
    ========================================= */

    function renderSlots() {

        const list = $("slotList");
        const meta = $("slotMeta");

        meta.textContent = "";

        if (!state.service) {
            list.innerHTML = '<p class="hint">Choose a service to continue.</p>';
            return;
        }

        if (!state.date) {
            list.innerHTML = '<p class="hint">Pick a date to see the available times.</p>';
            return;
        }

        if (state.loadingSlots) {
            list.innerHTML = '<p class="hint">Checking availability...</p>';
            return;
        }

        const slots = generateSlots(SERVICES[state.service]);

        let available = 0;

        const button = (time) => {

            const taken = state.taken.has(slotKey(time));
            const past = isSlotPast(state.date, time);
            const unavailable = taken || past;

            if (!unavailable) available++;

            return `
                <button type="button"
                        class="slot${state.time === time ? " selected" : ""}"
                        data-time="${time}"
                        aria-pressed="${state.time === time}"
                        ${unavailable ? "disabled" : ""}>
                    ${formatTime(time)}
                    ${taken ? "<small>Taken</small>" : ""}
                </button>
            `;
        };

        const group = (title, times) => times.length
            ? `<div class="slot-group"><h4>${title}</h4><div class="slot-grid">${times.map(button).join("")}</div></div>`
            : "";

        const html =
            group("Morning", slots.filter((t) => toMinutes(t) < 12 * 60)) +
            group("Afternoon", slots.filter((t) => toMinutes(t) >= 12 * 60));

        if (available === 0) {
            list.innerHTML =
                '<p class="hint">No times are available on this date. Please pick another day.</p>' + html;
            meta.textContent = "";
            return;
        }

        list.innerHTML = html;
        meta.textContent = `${available} time${available === 1 ? "" : "s"} available`;
    }

    $("slotList").addEventListener("click", (event) => {

        const button = event.target.closest(".slot");

        if (!button || button.disabled) return;

        state.time = button.dataset.time;

        renderSlots();
        updateSummary();
    });


    /* =========================================
       STEP 4: REASON
    ========================================= */

    $("reason").addEventListener("input", () => {
        $("reasonCount").textContent = `${$("reason").value.length} / ${MAX_REASON}`;
    });


    /* =========================================
       SUMMARY
    ========================================= */

    function setSummary(id, value) {
        const el = $(id);
        el.textContent = value || "Not selected";
        el.classList.toggle("empty", !value);
    }

    function updateSummary() {

        const service = SERVICES[state.service];

        setSummary("sumService", service ? service.name : "");
        setSummary("sumDate", state.date ? formatDateLong(state.date) : "");
        setSummary("sumTime", state.time
            ? `${formatTime(state.time)} – ${formatTime(toTime(toMinutes(state.time) + SLOT_MINUTES))}`
            : "");

        $("sumPatient").textContent = patientLabel || "Loading...";

        $("confirmBtn").disabled =
            !(state.service && state.date && state.time) || state.submitting || !currentUser;

        $("confirmBtn").textContent = state.submitting ? "Booking..." : "Confirm Appointment";
    }


    /* =========================================
       BOOK APPOINTMENT
    ========================================= */

    const isActive = (a) => ["pending", "confirmed"].includes(String(a.status || "pending").toLowerCase());

    async function submitBooking() {

        if (!currentUser || state.submitting) return;
        if (!(state.service && state.date && state.time)) return;

        const service = SERVICES[state.service];

        // The chosen time may have passed while the page was open
        if (isSlotPast(state.date, state.time)) {
            toast("That time has already passed. Please choose another.", "error");
            state.time = "";
            renderDays();
            renderSlots();
            updateSummary();
            return;
        }

        // The patient can't be in two places at once
        const sameTime = myAppointments.find((a) =>
            isActive(a) && a.date === state.date && a.time === state.time);

        if (sameTime) {
            toast("You already have an appointment at that time.", "error");
            return;
        }

        const sameService = myAppointments.find((a) =>
            isActive(a) && a.date === state.date && a.service === state.service);

        if (sameService) {
            toast(`You already have a ${service.name} appointment on that day.`, "error");
            return;
        }

        state.submitting = true;
        updateSummary();

        try {

            const slotPath = `slots/${state.date}/${state.service}/${slotKey(state.time)}`;

            // Last check: someone else may have taken the time a moment ago
            const existing = await get(ref(db, slotPath));

            if (existing.exists()) {
                toast("Sorry, that time was just booked by someone else. Please pick another.", "error");
                state.time = "";
                await loadTakenSlots();
                renderSlots();
                return;
            }

            const newRef = push(ref(db, "appointments"));
            const historyKey = push(ref(db, `appointments/${newRef.key}/history`)).key;

            const record = {
                uid: currentUser.uid,
                patientName: patientLabel.replace(/ \(.*\)$/, ""),
                patientId,
                patientPhone,
                patientEmail: currentUser.email || "",   // used for the approval email
                patientRole: PAGE_ROLE,
                service: state.service,
                serviceName: service.name,
                date: state.date,
                time: state.time,
                reason: $("reason").value.trim(),
                status: "pending",
                createdAt: serverTimestamp(),
                history: {
                    [historyKey]: historyEntry("booked", "pending")
                }
            };

            // One write: the appointment and the slot it reserves succeed or fail together
            await update(ref(db), {
                [`appointments/${newRef.key}`]: record,
                [slotPath]: currentUser.uid
            });

            highlightId = newRef.key;

            toast("Appointment booked! The clinic will confirm it soon.", "success");

            // Reset the form
            state.service = "";
            state.date = "";
            state.time = "";
            state.taken = new Set();
            $("reason").value = "";
            $("reasonCount").textContent = `0 / ${MAX_REASON}`;

            renderServices();
            renderDays();
            renderSlots();

            activeFilter = "upcoming";
            await loadAppointments();
            showTab("mine");
            window.scrollTo({ top: 0, behavior: "smooth" });

            setTimeout(() => {
                highlightId = null;
                renderAppointments();
            }, 5000);

        } catch (error) {

            console.error("Booking error:", error);

            const denied = error?.code === "PERMISSION_DENIED" ||
                /permission[_ ]denied/i.test(error?.message || "");

            toast(
                denied
                    ? "Booking was denied. Your account may not have a student/employee profile yet, or that time was just taken."
                    : "Sorry, we couldn't book your appointment. Please try again.",
                "error"
            );

        } finally {

            state.submitting = false;
            updateSummary();
        }
    }

    $("confirmBtn").addEventListener("click", submitBooking);


    /* =========================================
       MY APPOINTMENTS
    ========================================= */

    async function loadAppointments() {

        if (!currentUser) return;

        try {

            const snapshot = await get(
                query(ref(db, "appointments"), orderByChild("uid"), equalTo(currentUser.uid))
            );

            myAppointments = snapshot.exists()
                ? Object.entries(snapshot.val()).map(([id, value]) => ({ id, ...value }))
                : [];

            appointmentsLoaded = true;

        } catch (error) {

            console.error("Failed to load appointments:", error);
            appointmentsLoaded = false;

            $("appointmentList").innerHTML = `
                <div class="empty-state">
                    <h4>We couldn't load your appointments</h4>
                    <p>Please check your connection and try again.</p>
                    <button type="button" class="btn-primary" id="retryBtn">Try again</button>
                </div>
            `;

            return;
        }

        renderAppointments();
    }

    function appointmentTime(a) {
        return a.date && a.time ? slotDate(a.date, a.time) : new Date(0);
    }

    function bucketOf(a) {

        const status = String(a.status || "pending").toLowerCase();

        if (status === "cancelled") return "cancelled";
        if (status === "completed" || status === "missed") return "past";

        return appointmentTime(a) >= new Date() ? "upcoming" : "past";
    }

    function statusOf(a, bucket) {

        const status = String(a.status || "pending").toLowerCase();

        if (status === "cancelled") return { label: "Cancelled", cls: "cancelled" };
        if (status === "completed") return { label: "Completed", cls: "completed" };
        if (status === "missed")    return { label: "Missed", cls: "missed" };
        if (bucket === "past")      return { label: "Missed", cls: "missed" };
        if (status === "confirmed") return { label: "Confirmed", cls: "confirmed" };

        return { label: "Pending", cls: "pending" };
    }

    // bucket decides the badge/action; showHistory adds the timeline (History tab)
    function appointmentCard(a, bucket, showHistory = false) {

        const service = SERVICES[a.service];
        const name = service ? service.name : (a.serviceName || "Appointment");

        const day = a.date ? parseDateKey(a.date) : null;
        const month = day ? day.toLocaleDateString("en-US", { month: "short" }) : "--";
        const dayNum = day ? day.getDate() : "--";

        const status = statusOf(a, bucket);

        const when = a.date && a.time
            ? `${day.toLocaleDateString("en-US", { weekday: "long" })} · ${formatTime(a.time)} – ${formatTime(toTime(toMinutes(a.time) + SLOT_MINUTES))}`
            : "Date to be confirmed";

        const action = bucket === "upcoming"
            ? `<button type="button" class="link-btn danger" data-cancel="${escapeHtml(a.id)}">Cancel</button>`
            : (service ? `<button type="button" class="link-btn" data-rebook="${escapeHtml(a.service)}">Book again</button>` : "");

        return `
            <article class="appt-card${a.id === highlightId ? " highlight" : ""}">
                <div class="appt-date">
                    <span class="month">${month}</span>
                    <span class="day">${dayNum}</span>
                </div>

                <div class="appt-info">
                    <h4>${escapeHtml(name)}</h4>
                    <p class="appt-when">${when}</p>
                    ${a.reason ? `<p class="appt-reason">${escapeHtml(a.reason)}</p>` : ""}
                    ${a.clinicNote ? `<p class="appt-reason"><strong>Clinic note:</strong> ${escapeHtml(a.clinicNote)}</p>` : ""}
                    ${showHistory ? historyTimeline(a) : ""}
                </div>

                <div class="appt-side">
                    <span class="badge ${status.cls}">${status.label}</span>
                    ${action}
                </div>
            </article>
        `;
    }

    function renderAppointments() {

        if (!appointmentsLoaded) return;

        const groups = { upcoming: [], past: [], cancelled: [], history: [] };

        myAppointments.forEach((a) => {
            groups[bucketOf(a)].push(a);
            groups.history.push(a);   // History = every appointment, with its timeline
        });

        // Soonest first for upcoming, most recent first for the rest
        groups.upcoming.sort((a, b) => appointmentTime(a) - appointmentTime(b));
        groups.past.sort((a, b) => appointmentTime(b) - appointmentTime(a));
        groups.cancelled.sort((a, b) => appointmentTime(b) - appointmentTime(a));
        groups.history.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));

        $("countUpcoming").textContent = groups.upcoming.length;
        $("countPast").textContent = groups.past.length;
        $("countCancelled").textContent = groups.cancelled.length;

        // Only exists once the History button is added to the HTML
        if ($("countHistory")) $("countHistory").textContent = groups.history.length;

        $("tabCount").textContent = groups.upcoming.length;
        $("tabCount").hidden = groups.upcoming.length === 0;

        document.querySelectorAll(".filter").forEach((button) => {
            button.classList.toggle("active", button.dataset.filter === activeFilter);
        });

        const items = groups[activeFilter] || [];

        if (items.length === 0) {

            const copy = {
                upcoming: ["No upcoming appointments", "When you book a visit, it will show up here."],
                past: ["No past appointments", "Your completed and missed visits will appear here."],
                cancelled: ["No cancelled appointments", "Appointments you cancel will appear here."],
                history: ["No history yet", "Every booking, approval and cancellation will be recorded here."]
            }[activeFilter] || ["Nothing here", ""];

            $("appointmentList").innerHTML = `
                <div class="empty-state">
                    <h4>${copy[0]}</h4>
                    <p>${copy[1]}</p>
                    ${activeFilter === "upcoming" ? '<button type="button" class="btn-primary" data-go-book>Book an appointment</button>' : ""}
                </div>
            `;

            return;
        }

        const isHistory = activeFilter === "history";

        $("appointmentList").innerHTML =
            `<div class="appointment-list">${items.map((a) =>
                appointmentCard(a, isHistory ? bucketOf(a) : activeFilter, isHistory)
            ).join("")}</div>`;
    }

    $("filters").addEventListener("click", (event) => {

        const button = event.target.closest(".filter");

        if (!button) return;

        activeFilter = button.dataset.filter;
        renderAppointments();
    });

    $("appointmentList").addEventListener("click", (event) => {

        const cancel = event.target.closest("[data-cancel]");
        const rebook = event.target.closest("[data-rebook]");

        if (cancel) {
            openCancelModal(cancel.dataset.cancel);
            return;
        }

        if (rebook) {
            selectService(rebook.dataset.rebook);
            showTab("book");
            window.scrollTo({ top: 0, behavior: "smooth" });
            return;
        }

        if (event.target.closest("[data-go-book]")) {
            showTab("book");
            return;
        }

        if (event.target.closest("#retryBtn")) {
            loadAppointments();
        }
    });


    /* =========================================
       CANCEL APPOINTMENT
    ========================================= */

    function openCancelModal(id) {

        const a = myAppointments.find((item) => item.id === id);

        if (!a) return;

        pendingCancel = a;

        const service = SERVICES[a.service];
        const name = service ? service.name : (a.serviceName || "appointment");

        const hoursAway = (appointmentTime(a) - new Date()) / 36e5;

        $("cancelDetail").innerHTML =
            `<strong>${escapeHtml(name)}</strong><br>${formatDateLong(a.date)} at ${formatTime(a.time)}` +
            (hoursAway < 24
                ? '<span class="warn">This appointment is less than a day away. Please cancel only if you really can\'t make it.</span>'
                : "");

        $("cancelModal").classList.add("show");
        $("cancelKeep").focus();
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

        if (!a || !currentUser) return;

        $("cancelConfirm").disabled = true;

        try {

            const historyKey = push(ref(db, `appointments/${a.id}/history`)).key;

            const changes = {
                [`appointments/${a.id}/status`]: "cancelled",
                [`appointments/${a.id}/cancelledAt`]: serverTimestamp(),
                [`appointments/${a.id}/history/${historyKey}`]: historyEntry("cancelled", "cancelled")
            };

            // Free the time slot so someone else can book it
            if (SERVICES[a.service] && a.date && a.time) {
                changes[`slots/${a.date}/${a.service}/${slotKey(a.time)}`] = null;
            }

            await update(ref(db), changes);

            closeCancelModal();
            toast("Your appointment was cancelled.", "success");

            await loadAppointments();

            // Refresh availability if the same day is open on the booking tab
            if (state.service === a.service && state.date === a.date) {
                await loadTakenSlots();
                renderSlots();
            }

        } catch (error) {

            console.error("Cancel error:", error);
            toast("We couldn't cancel that appointment. Please try again.", "error");

        } finally {

            $("cancelConfirm").disabled = false;
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
            toast("Unable to log out.", "error");
        }
    }

    [$("logoutBtn"), $("mobileLogoutBtn")].forEach((button) => {
        if (button) button.addEventListener("click", handleLogout);
    });


    /* =========================================
       AUTHENTICATION + LOAD DATA
    ========================================= */

    onAuthStateChanged(auth, async (user) => {

        if (!user) {
            window.location.href = "../login/login.html";
            return;
        }

        // The admin has its own page
        if (user.uid === ADMIN_UID) {
            window.location.replace("../admin/admin.html");
            return;
        }

        currentUser = user;

        patientLabel = user.displayName || user.email || ROLE.label;
        updateSummary();

        // Name + ID from this page's folder: students/{uid} or employees/{uid}
        try {

            const ownFolder = PAGE_ROLE === "employee" ? "employees" : "students";
            const otherFolder = PAGE_ROLE === "employee" ? "students" : "employees";

            const snapshot = await get(ref(db, `${ownFolder}/${user.uid}`));

            if (snapshot.exists()) {

                const data = snapshot.val();

                const name = data.fullName || data.name || patientLabel;

                patientId = data[ROLE.idField] || data.studentId || data.employeeId || "";
                patientPhone = data.phone || data.contactNumber || "";
                patientLabel = patientId ? `${name} (${patientId})` : name;

            } else {

                // Not found here: maybe they belong on the other page
                const otherSnap = await get(ref(db, `${otherFolder}/${user.uid}`));

                if (otherSnap.exists()) {
                    window.location.replace(ROLE.other);
                    return;
                }

                toast("We couldn't find your profile. Please contact the clinic.", "error");
            }

        } catch (error) {
            console.warn("Could not load profile:", error);
        }

        updateSummary();

        await loadAppointments();
    });


    /* =========================================
       START
       ?service=dental   opens the booking tab with that service chosen
       ?tab=mine         opens My Appointments
    ========================================= */

    renderServices();
    renderDays();
    renderSlots();
    updateSummary();

    const params = new URLSearchParams(location.search);

    if (params.get("tab") === "mine") {
        showTab("mine", false);
    } else if (params.get("service") && SERVICES[params.get("service")]) {
        selectService(params.get("service"));
    }

});
