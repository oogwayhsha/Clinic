// ==========================================
// APPOINTMENTS PAGE: request + manage appointments
// Used by students (st-appointment.html) and employees (em-appointment.html).
// One appointment per 30-minute slot; the clinic approves each request.
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
    orderByKey,
    startAt,
    endAt,
    equalTo,
    onValue,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

import { SWEEP_MS, BOOKING_LIMITS } from "../shared/config.js";

import {
    BOOKING_WINDOW_DAYS,
    HOURS_TEXT,
    DAY_SLOTS,
    toDateKey,
    parseDateKey,
    toMinutes,
    formatTime,
    formatRange,
    formatDateLong,
    formatMoment,
    slotKey,
    isSlotPast,
    escapeHtml,
    isClinicDay,
    isTaken,
    openSlots,
    reasonOf,
    serviceOf,
    serviceNameOf,
    visitLabel,
    startOf,
    stateOf,
    stateLabel,
    STATE_INFO,
    isActive,
    reminderTimes,
    historyTimelineHtml
} from "../shared/clinic.js";

import { SERVICES, serviceName, normalizeReasons } from "../shared/reasons.js";
import { isClinicAdmin } from "../shared/access.js";
import { mountBell } from "../shared/notify.js";

import {
    notifyNewRequest,
    cancelAppointment,
    confirmAttendance,
    sweepAppointments
} from "../shared/actions.js";


document.addEventListener("DOMContentLoaded", () => {

    // <body data-role="student|employee"> decides which kind of patient this is
    const PAGE_ROLE = document.body.dataset.role === "employee" ? "employee" : "student";

    const ROLE = {
        student:  { idField: "studentId",  label: "Student",  other: "../employee/em-appointment.html" },
        employee: { idField: "employeeId", label: "Employee", other: "../student/st-appointment.html" }
    }[PAGE_ROLE];


    /* =========================================
       HELPERS
    ========================================= */

    const $ = (id) => document.getElementById(id);

    function toast(message, type = "info") {
        const el = document.createElement("div");
        el.className = `toast ${type}`;
        el.textContent = message;
        $("toasts").appendChild(el);

        setTimeout(() => el.remove(), 5000);
    }

    const isDenied = (error) =>
        error?.code === "PERMISSION_DENIED" || /permission[_ ]denied/i.test(error?.message || "");


    /* =========================================
       STATE
    ========================================= */

    let currentUser = null;
    let patient = { name: "", id: "", phone: "", email: "" };

    let reasons = normalizeReasons(null);
    let slots = {};             // timeSlots/{date}/{HHMM} = appointmentId
    let closures = {};          // clinicClosures/{date} = note
    let slotsLoaded = false;

    let myAppointments = [];
    let appointmentsLoaded = false;
    let activeFilter = "upcoming";
    let highlightId = null;
    let openedFromLink = false;

    const state = {
        service: "",
        reason: "",
        date: "",
        time: "",
        submitting: false
    };

    let pendingCancel = null;  // appointment waiting for cancel confirmation

    const actor = () => ({ uid: currentUser.uid, name: patient.name, role: "patient" });

    $("hoursNote").textContent = `The clinic takes appointments ${HOURS_TEXT}. You can book up to two weeks ahead.`;


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
       STEP 1: SERVICE, STEP 2: REASON (the clinic's list for that service)
    ========================================= */

    const SERVICE_ICONS = {
        consultation: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>',
        dental: '<path d="M7 4c-2.2 0-4 1.8-4 4.2 0 1.7.6 2.8 1.1 4.3C4.6 14.4 5 20 7 20c1.6 0 1.5-4 3-4h4c1.5 0 1.4 4 3 4 2 0 2.4-5.6 2.9-7.5.5-1.5 1.1-2.6 1.1-4.3C21 5.8 19.2 4 17 4c-1.5 0-2.5 1-5 1S8.5 4 7 4z"></path>',
        certificate: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><polyline points="9 15 11 17 15 13"></polyline>'
    };

    const reasonsFor = (service) => reasons.filter((r) => r.service === service);

    // ?service=dental (from a dashboard card) picks the service
    const linkedService = new URLSearchParams(location.search).get("service");
    if (SERVICES.some((s) => s.id === linkedService)) state.service = linkedService;

    function renderServices() {

        $("serviceList").innerHTML = SERVICES.map((s) => {
            const available = reasonsFor(s.id).length > 0;
            const selected = state.service === s.id;

            return `
                <button type="button" class="service-option${selected ? " selected" : ""}" role="radio"
                        aria-checked="${selected}" data-service="${s.id}" ${available ? "" : "disabled"}>
                    <span class="service-option-icon ${s.id}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SERVICE_ICONS[s.id]}</svg>
                    </span>
                    <span class="service-option-text">
                        <strong>${escapeHtml(s.name)}</strong>
                        <small>${available ? escapeHtml(s.blurb) : "Not open for booking right now."}</small>
                    </span>
                </button>`;
        }).join("");
    }

    function renderReasons() {

        // The clinic may have switched off every reason of the chosen service
        if (state.service && reasonsFor(state.service).length === 0) state.service = "";

        renderServices();

        const select = $("reason");
        const list = reasonsFor(state.service);
        const previous = state.reason;

        select.disabled = !state.service;
        select.replaceChildren(new Option(state.service ? "Select a reason" : "Choose a service first", ""));
        list.forEach((r) => select.add(new Option(r.name, r.name)));

        // Keep the choice if it's still on the list for this service
        state.reason = list.some((r) => r.name === previous) ? previous : "";
        select.value = state.reason;

        $("reasonNote").textContent = state.service
            ? `${serviceName(state.service)}: choose the one that fits best.`
            : "Choose a service first.";

        updateSummary();
    }

    $("serviceList").addEventListener("click", (event) => {
        const option = event.target.closest("[data-service]");
        if (!option || option.disabled) return;

        if (state.service !== option.dataset.service) {
            state.service = option.dataset.service;
            state.reason = "";
        }

        renderReasons();
        $("reason").focus();
    });

    // Arrow keys move between services, like radio buttons
    $("serviceList").addEventListener("keydown", (event) => {
        if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(event.key)) return;

        const options = [...$("serviceList").querySelectorAll("[data-service]:not([disabled])")];
        const index = options.indexOf(document.activeElement);
        if (index < 0) return;

        event.preventDefault();
        const step = ["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1;
        options[(index + step + options.length) % options.length].focus();
    });

    $("reason").addEventListener("change", (event) => {
        state.reason = event.target.value;
        updateSummary();
    });


    /* =========================================
       STEP 2: DATES
    ========================================= */

    function renderDays() {

        const list = $("dayList");

        if (!slotsLoaded) {
            list.innerHTML = '<p class="hint">Checking availability...</p>';
            return;
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let html = "";
        let anyOpen = false;

        for (let i = 0; i < BOOKING_WINDOW_DAYS; i++) {

            const day = new Date(today);
            day.setDate(today.getDate() + i);

            const key = toDateKey(day);
            const clinicDay = isClinicDay(key, closures);
            const open = openSlots(key, slots[key], closures).length > 0;
            const full = clinicDay && !open && DAY_SLOTS.some((t) => !isSlotPast(key, t));
            const selected = key === state.date;

            if (open) anyOpen = true;

            const weekday = i === 0
                ? "Today"
                : day.toLocaleDateString("en-US", { weekday: "short" });

            const note = closures[key] ? "Closed"
                : full ? "Full"
                : day.toLocaleDateString("en-US", { month: "short" });

            html += `
                <button type="button"
                        class="day-btn${selected ? " selected" : ""}"
                        data-date="${key}"
                        aria-pressed="${selected}"
                        ${open ? "" : `disabled title="${closures[key] ? escapeHtml(`Clinic closed: ${closures[key]}`) : full ? "Fully booked" : "Clinic closed"}"`}>
                    <span class="day-name">${weekday}</span>
                    <span class="day-num">${day.getDate()}</span>
                    <span class="day-month">${escapeHtml(note)}</span>
                </button>
            `;
        }

        list.innerHTML = (anyOpen ? "" : '<p class="hint wide">No open slots in the next two weeks. Please check again later.</p>') + html;
    }

    $("dayList").addEventListener("click", (event) => {

        const button = event.target.closest(".day-btn");
        if (!button || button.disabled) return;

        state.date = button.dataset.date;
        state.time = "";

        renderDays();
        renderSlots();
        updateSummary();
    });


    /* =========================================
       STEP 3: TIMES
    ========================================= */

    function renderSlots() {

        const list = $("slotList");
        const meta = $("slotMeta");

        meta.textContent = "";

        if (!state.date) {
            list.innerHTML = '<p class="hint">Pick a date to see the available times.</p>';
            return;
        }

        let available = 0;

        const button = (time) => {

            const taken = isTaken(slots[state.date], time);
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
                    ${taken ? '<small class="full">Taken</small>' : ""}
                </button>
            `;
        };

        const group = (title, items) => items.length
            ? `<div class="slot-group"><h4>${title}</h4><div class="slot-grid">${items.map(button).join("")}</div></div>`
            : "";

        const html =
            group("Morning", DAY_SLOTS.filter((t) => toMinutes(t) < 12 * 60)) +
            group("Afternoon", DAY_SLOTS.filter((t) => toMinutes(t) >= 12 * 60 && toMinutes(t) < 17 * 60)) +
            group("Evening", DAY_SLOTS.filter((t) => toMinutes(t) >= 17 * 60));

        if (available === 0) {
            list.innerHTML = '<p class="hint">No times are available on this date. Please pick another day.</p>' + html;
            return;
        }

        list.innerHTML = html;
        meta.textContent = `${available} slot${available === 1 ? "" : "s"} open`;
    }

    $("slotList").addEventListener("click", (event) => {

        const button = event.target.closest(".slot");

        if (!button || button.disabled) return;

        state.time = button.dataset.time;

        renderSlots();
        updateSummary();
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

        setSummary("sumService", serviceName(state.service));
        setSummary("sumReason", state.reason);
        setSummary("sumDate", state.date ? formatDateLong(state.date) : "");
        setSummary("sumTime", state.time ? formatRange(state.time) : "");

        $("sumPatient").textContent = patient.name
            ? (patient.id ? `${patient.name} (${patient.id})` : patient.name)
            : "Loading...";

        $("confirmBtn").disabled =
            !(state.service && state.reason && state.date && state.time) || state.submitting || !currentUser;

        $("confirmBtn").textContent = state.submitting ? "Sending..." : "Send Request";
    }

    function renderBooking() {
        renderDays();
        renderSlots();
        updateSummary();
    }


    /* =========================================
       SEND REQUEST
       The appointment and its time slot are written in one update,
       and the database rules refuse a slot that's already taken, so
       two people can never get the same 30 minutes.
    ========================================= */

    function limitProblem() {

        const upcoming = myAppointments.filter((a) => isActive(a) && startOf(a) > new Date());

        if (upcoming.some((a) => a.date === state.date && a.time === state.time)) {
            return "You already have an appointment at that time.";
        }

        if (upcoming.filter((a) => a.date === state.date).length >= BOOKING_LIMITS.perDay) {
            return BOOKING_LIMITS.perDay === 1
                ? "You already have an appointment on that day. Cancel it first if you need a different time."
                : `You can have at most ${BOOKING_LIMITS.perDay} appointments on one day.`;
        }

        if (upcoming.length >= BOOKING_LIMITS.upcoming) {
            return `You already have ${upcoming.length} upcoming appointments. Please wait for them or cancel one before booking another.`;
        }

        return "";
    }

    async function submitBooking() {

        if (!currentUser || state.submitting) return;
        if (!(state.service && state.reason && state.date && state.time)) return;

        // The chosen time may have passed while the page was open
        if (isSlotPast(state.date, state.time)) {
            toast("That time has already passed. Please choose another.", "error");
            state.time = "";
            renderBooking();
            return;
        }

        const problem = limitProblem();

        if (problem) {
            toast(problem, "error");
            return;
        }

        state.submitting = true;
        updateSummary();

        try {

            const newRef = push(ref(db, "appointments"));

            const record = {
                uid: currentUser.uid,
                patientName: patient.name,
                patientId: patient.id,
                patientPhone: patient.phone,
                patientEmail: patient.email,
                patientRole: PAGE_ROLE,
                service: state.service,
                reason: state.reason,
                date: state.date,
                time: state.time,
                status: "pending",
                createdAt: serverTimestamp(),
                history: {
                    [push(ref(db, `appointments/${newRef.key}/history`)).key]: {
                        action: "booked",
                        by: currentUser.uid,
                        byRole: "patient",
                        byName: patient.name,
                        at: serverTimestamp(),
                        note: `${serviceName(state.service)} · ${state.reason}`
                    }
                }
            };

            // One write: if the slot was just taken, the rules refuse all of it
            await update(ref(db), {
                [`appointments/${newRef.key}`]: record,
                [`timeSlots/${state.date}/${slotKey(state.time)}`]: newRef.key
            });

            notifyNewRequest({ id: newRef.key, ...record });

            highlightId = newRef.key;

            toast("Request sent! You'll get an email once the clinic approves it.", "success");

            state.date = "";
            state.time = "";

            activeFilter = "upcoming";
            showTab("mine");
            window.scrollTo({ top: 0, behavior: "smooth" });

            setTimeout(() => {
                highlightId = null;
                renderAppointments();
            }, 5000);

        } catch (error) {

            console.error("Booking error:", error);

            if (isDenied(error)) {
                toast("Sorry, that slot was just taken (or your account has no student/employee profile). Please pick another time.", "error");
                state.time = "";
            } else {
                toast("Sorry, we couldn't send your request. Please try again.", "error");
            }

        } finally {

            state.submitting = false;
            renderBooking();
        }
    }

    $("confirmBtn").addEventListener("click", submitBooking);


    /* =========================================
       MY APPOINTMENTS (live) + BOOKING HISTORY
    ========================================= */

    function bucketOf(a) {

        const current = stateOf(a);

        if (["cancelled", "declined", "lapsed", "expired"].includes(current)) return "cancelled";
        if (["completed", "missed"].includes(current)) return "past";

        return startOf(a) >= new Date() ? "upcoming" : "past";
    }

    function stateNote(a, current) {

        const t = reminderTimes(a);

        switch (current) {
            case "pending":
                return '<p class="appt-note">Waiting for the clinic to approve your request.</p>';
            case "approved":
                return `<p class="appt-note">Approved. We'll ask you to confirm you're still coming on ${escapeHtml(formatMoment(t.first))}.</p>`;
            case "awaiting":
                return `
                    <div class="confirm-box">
                        <p><strong>Are you still coming?</strong> Please confirm by ${escapeHtml(formatMoment(t.deadline))}, or this appointment will be cancelled so someone else can use the slot.</p>
                        <div class="confirm-actions">
                            <button type="button" class="btn-primary small" data-attend="${escapeHtml(a.id)}">Yes, I'll be there</button>
                            <button type="button" class="link-btn danger" data-cancel="${escapeHtml(a.id)}">No, cancel it</button>
                        </div>
                    </div>`;
            case "attending":
                return startOf(a) >= new Date()
                    ? '<p class="appt-note good">✓ You confirmed you\'re coming. Please arrive 10 minutes early and bring your ID.</p>'
                    : "";
            case "lapsed":
                return '<p class="appt-note bad">This appointment wasn\'t confirmed in time, so it was cancelled.</p>';
            case "expired":
                return '<p class="appt-note bad">This request wasn\'t approved before the visit time. Please book again.</p>';
            case "declined":
                return `<p class="appt-note bad">Declined${a.declineReason ? `: ${escapeHtml(a.declineReason)}` : "."}</p>`;
            case "cancelled":
                if (a.cancelReason === "no-confirmation") return '<p class="appt-note bad">Cancelled automatically because it wasn\'t confirmed in time.</p>';
                if (a.cancelReason === "expired") return '<p class="appt-note bad">This request wasn\'t approved before the visit time.</p>';
                if (a.cancelledBy && a.cancelledBy !== "patient") {
                    return `<p class="appt-note bad">Cancelled by the clinic${a.clinicNote ? `: ${escapeHtml(a.clinicNote)}` : "."}</p>`;
                }
                return "";
            default:
                return "";
        }
    }

    // showHistory adds the timeline (Booking History filter)
    function appointmentCard(a, bucket, showHistory = false) {

        const current = stateOf(a);

        const day = a.date ? parseDateKey(a.date) : null;
        const month = day ? day.toLocaleDateString("en-US", { month: "short" }) : "--";
        const dayNum = day ? day.getDate() : "--";

        const when = a.date && a.time
            ? `${day.toLocaleDateString("en-US", { weekday: "long" })} · ${formatRange(a.time)}`
            : "Date to be confirmed";

        const canCancel = bucket === "upcoming" && ["pending", "approved", "attending"].includes(current);

        const action = canCancel
            ? `<button type="button" class="link-btn danger" data-cancel="${escapeHtml(a.id)}">Cancel</button>`
            : (bucket !== "upcoming"
                ? `<button type="button" class="link-btn" data-rebook="${escapeHtml(a.id)}">Book again</button>`
                : "");

        return `
            <article class="appt-card${a.id === highlightId ? " highlight" : ""}" id="appt-${escapeHtml(a.id)}">
                <div class="appt-date">
                    <span class="month">${month}</span>
                    <span class="day">${dayNum}</span>
                </div>

                <div class="appt-info">
                    <span class="appt-service">${escapeHtml(serviceNameOf(a))}</span>
                    <h4>${escapeHtml(reasonOf(a))}</h4>
                    <p class="appt-when">${when}</p>

                    ${stateNote(a, current)}

                    ${a.instructions && !["cancelled", "declined", "lapsed", "expired"].includes(current) ? `
                        <div class="instructions-box">
                            <span>How to prepare</span>
                            <p>${escapeHtml(a.instructions)}</p>
                        </div>` : ""}

                    ${showHistory ? historyTimelineHtml(a) : ""}
                </div>

                <div class="appt-side">
                    <span class="badge ${STATE_INFO[current]?.cls || "pending"}">${escapeHtml(stateLabel(a, current))}</span>
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
            groups.history.push(a);   // Booking history = every appointment, with its timeline
        });

        // Soonest first for upcoming, most recent first for the rest
        groups.upcoming.sort((a, b) => startOf(a) - startOf(b));
        groups.past.sort((a, b) => startOf(b) - startOf(a));
        groups.cancelled.sort((a, b) => startOf(b) - startOf(a));
        groups.history.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));

        $("countUpcoming").textContent = groups.upcoming.length;
        $("countPast").textContent = groups.past.length;
        $("countCancelled").textContent = groups.cancelled.length;
        $("countHistory").textContent = groups.history.length;

        // The tab badge counts visits that need the patient to answer
        const needAnswer = groups.upcoming.filter((a) => stateOf(a) === "awaiting").length;
        $("tabCount").textContent = needAnswer || groups.upcoming.length;
        $("tabCount").hidden = groups.upcoming.length === 0;
        $("tabCount").classList.toggle("alert", needAnswer > 0);

        document.querySelectorAll(".filter").forEach((button) => {
            button.classList.toggle("active", button.dataset.filter === activeFilter);
        });

        const items = groups[activeFilter];

        if (items.length === 0) {

            const copy = {
                upcoming: ["No upcoming appointments", "When you request a visit, it will show up here."],
                past: ["No past appointments", "Your completed and missed visits will appear here."],
                cancelled: ["Nothing cancelled or declined", "Cancelled and declined requests will appear here."],
                history: ["No booking history yet", "Every request, approval, reminder and cancellation is recorded here."]
            }[activeFilter];

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
                appointmentCard(a, isHistory ? bucketOf(a) : activeFilter, isHistory)).join("")}</div>`;
    }

    // Opens My Appointments on one appointment (email / notification links)
    function focusAppointment(id) {

        const a = myAppointments.find((item) => item.id === id);
        if (!a) return;

        activeFilter = bucketOf(a);
        highlightId = id;
        showTab("mine", false);
        renderAppointments();

        document.getElementById(`appt-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });

        setTimeout(() => {
            highlightId = null;
            renderAppointments();
        }, 6000);
    }

    window.addEventListener("bell:open", (event) => {
        if (event.detail?.apptId) focusAppointment(event.detail.apptId);
    });

    $("filters").addEventListener("click", (event) => {

        const button = event.target.closest(".filter");

        if (!button) return;

        activeFilter = button.dataset.filter;
        renderAppointments();
    });

    $("appointmentList").addEventListener("click", async (event) => {

        const cancel = event.target.closest("[data-cancel]");
        const rebook = event.target.closest("[data-rebook]");
        const attend = event.target.closest("[data-attend]");

        if (attend) {

            const a = myAppointments.find((item) => item.id === attend.dataset.attend);
            if (!a) return;

            attend.disabled = true;

            try {
                await confirmAttendance(a, actor());
                toast("Thanks! The clinic knows you're coming.", "success");
            } catch (error) {
                console.error("Confirm error:", error);
                toast("We couldn't save that. Please try again.", "error");
                attend.disabled = false;
            }
            return;
        }

        if (cancel) {
            openCancelModal(cancel.dataset.cancel);
            return;
        }

        if (rebook) {
            const old = myAppointments.find((item) => item.id === rebook.dataset.rebook);

            // Same service and reason as before, if the clinic still offers them
            if (old && reasonsFor(serviceOf(old)).length) {
                state.service = serviceOf(old);
                state.reason = reasonsFor(state.service).some((r) => r.name === reasonOf(old)) ? reasonOf(old) : "";
            }

            renderReasons();
            showTab("book");
            window.scrollTo({ top: 0, behavior: "smooth" });
            return;
        }

        if (event.target.closest("[data-go-book]")) {
            showTab("book");
        }
    });


    /* =========================================
       CANCEL APPOINTMENT
    ========================================= */

    function openCancelModal(id) {

        const a = myAppointments.find((item) => item.id === id);

        if (!a) return;

        pendingCancel = a;

        const hoursAway = (startOf(a) - new Date()) / 36e5;

        $("cancelDetail").innerHTML =
            `<strong>${escapeHtml(visitLabel(a))}</strong><br>${formatDateLong(a.date)} at ${formatTime(a.time)}` +
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

            await cancelAppointment(a, actor());

            closeCancelModal();
            toast("Your appointment was cancelled.", "success");

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
       LIVE DATA
    ========================================= */

    function watchClinic() {

        const today = new Date();
        const last = new Date();
        last.setDate(today.getDate() + BOOKING_WINDOW_DAYS);

        const range = (path) =>
            query(ref(db, path), orderByKey(), startAt(toDateKey(today)), endAt(toDateKey(last)));

        let gotSlots = false;
        let gotClosures = false;

        const ready = () => {
            if (!gotSlots || !gotClosures) return;

            slotsLoaded = true;

            // Someone else took the slot this patient was looking at
            if (state.time && !state.submitting && (isTaken(slots[state.date], state.time) || closures[state.date])) {
                toast("The time you picked was just taken. Please choose another.", "error");
                state.time = "";
            }

            renderBooking();
        };

        const failed = (what) => (error) => {
            console.warn(`Could not watch ${what}:`, error);
            gotSlots = true;
            gotClosures = true;
            ready();
            toast("Couldn't check live availability. A taken slot may be refused when you send.", "error");
        };

        onValue(range("timeSlots"), (snapshot) => {
            slots = snapshot.val() || {};
            gotSlots = true;
            ready();
        }, failed("time slots"));

        onValue(range("clinicClosures"), (snapshot) => {
            closures = snapshot.val() || {};
            gotClosures = true;
            ready();
        }, failed("clinic closures"));

        onValue(ref(db, "bookingReasons"), (snapshot) => {
            reasons = normalizeReasons(snapshot.val());
            renderReasons();
        }, (error) => {
            console.warn("Could not load booking reasons:", error);
            renderReasons();
        });
    }

    function watchAppointments() {

        onValue(
            query(ref(db, "appointments"), orderByChild("uid"), equalTo(currentUser.uid)),
            (snapshot) => {

                myAppointments = Object.entries(snapshot.val() || {}).map(([id, value]) => ({ id, ...value }));
                appointmentsLoaded = true;

                renderAppointments();

                const linked = new URLSearchParams(location.search).get("appt");
                if (linked && !openedFromLink) {
                    openedFromLink = true;
                    focusAppointment(linked);
                }
            },
            (error) => {
                console.error("Failed to load appointments:", error);
                $("appointmentList").innerHTML = `
                    <div class="empty-state">
                        <h4>We couldn't load your appointments</h4>
                        <p>Please check your connection and reload the page.</p>
                    </div>
                `;
            }
        );

        // Send due reminders / cancel unconfirmed visits, and keep the
        // "needs confirmation" states fresh as the clock moves
        const tick = () => {
            if (!appointmentsLoaded) return;
            sweepAppointments(myAppointments);
            renderAppointments();
        };

        setTimeout(tick, 3000);
        setInterval(tick, SWEEP_MS);
    }


    /* =========================================
       AUTHENTICATION + LOAD DATA
    ========================================= */

    onAuthStateChanged(auth, async (user) => {

        if (!user) {
            window.location.href = "../login/login.html";
            return;
        }

        currentUser = user;

        patient = {
            name: user.displayName || user.email || ROLE.label,
            id: "",
            phone: "",
            email: user.email || ""
        };

        updateSummary();

        // Name + ID from this page's folder: students/{uid} or employees/{uid}
        try {

            const ownFolder = PAGE_ROLE === "employee" ? "employees" : "students";
            const otherFolder = PAGE_ROLE === "employee" ? "students" : "employees";

            const snapshot = await get(ref(db, `${ownFolder}/${user.uid}`));

            if (snapshot.exists()) {

                const data = snapshot.val();

                patient = {
                    name: data.fullName || data.name || patient.name,
                    id: data[ROLE.idField] || data.studentId || data.employeeId || "",
                    phone: data.phone || data.contactNumber || "",
                    email: data.email || user.email || ""
                };

            } else {

                // Clinic staff have their own page
                if (await isClinicAdmin(user)) {
                    window.location.replace("../admin/admin.html");
                    return;
                }

                // Not found here: maybe they belong on the other page
                const otherSnap = await get(ref(db, `${otherFolder}/${user.uid}`)).catch(() => null);

                if (otherSnap?.exists()) {
                    window.location.replace(ROLE.other);
                    return;
                }

                toast("We couldn't find your profile. Please contact the clinic.", "error");
            }

        } catch (error) {
            console.warn("Could not load profile:", error);
        }

        mountBell(user.uid, [$("bellSlotDesktop"), $("bellSlotMobile")]);

        updateSummary();
        watchAppointments();
        watchClinic();
    });


    /* =========================================
       START
       ?tab=mine         opens My Appointments
       ?appt=ID          opens My Appointments on that appointment
    ========================================= */

    renderReasons();
    renderBooking();

    const params = new URLSearchParams(location.search);

    if (params.get("tab") === "mine" || params.get("appt")) {
        showTab("mine", false);
    }

});
