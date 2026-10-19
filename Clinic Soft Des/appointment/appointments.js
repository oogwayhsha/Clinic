// ==========================================
// APPOINTMENTS PAGE: request + manage appointments
// Used by students (st-appointment.html) and employees (em-appointment.html).
// ==========================================
import { auth, db } from "../firebase/firebase.js";

import {
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

import {
    ref,
    get,
    set,
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

import { ADMIN_UID, SWEEP_MS } from "../shared/config.js";

import {
    SERVICES,
    STAFF_TYPES,
    CONDITIONS,
    BOOKING_WINDOW_DAYS,
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
    describeDays,
    describeRanges,
    generateSlots,
    listOf,
    staffDisplayName,
    staffTypeLabel,
    staffWorksAt,
    eligibleStaff,
    freeStaffAt,
    pickStaff,
    rangesFor,
    startOf,
    stateOf,
    stateLabel,
    STATE_INFO,
    isActive,
    reminderTimes,
    hasMedicalHistory,
    medicalHistoryHtml,
    historyTimelineHtml
} from "../shared/clinic.js";

import { mountBell } from "../shared/notify.js";
import { loadAvatars, avatarInner } from "../shared/avatar.js";

import {
    notifyNewRequest,
    cancelAppointment,
    confirmAttendance,
    sweepAppointments
} from "../shared/actions.js";


import {
    DEFAULT_REASONS,
    normalizeReasons
} from "../shared/reasons.js";



document.addEventListener("DOMContentLoaded", () => {

    // <body data-role="student|employee"> decides which kind of patient this is
    const PAGE_ROLE = document.body.dataset.role === "employee" ? "employee" : "student";

    const ROLE = {
        student:  { idField: "studentId",  label: "Student",  other: "../employee/em-appointment.html" },
        employee: { idField: "employeeId", label: "Employee", other: "../student/st-appointment.html" }
    }[PAGE_ROLE];

    const MAX_REASON = 300;


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

    let staffMap = {};          // staff/{uid}
    let staffPhotos = {};       // uid -> photo
    let staffLoaded = false;
    let bookings = {};          // bookings/{date}/{staffId}/{HHMM} = appointmentId
    let bookingsLoaded = false;

    let myAppointments = [];
    let appointmentsLoaded = false;
    let activeFilter = "upcoming";
    let highlightId = null;
    let openedFromLink = false;

    const state = {
        service: "",
        pref: { kind: "any" },   // any | { kind: "type", type } | { kind: "person", staffId }
        date: "",
        time: "",
        submitting: false
    };

    let pendingCancel = null;  // appointment waiting for cancel confirmation

    const actor = () => ({ uid: currentUser.uid, name: patient.name, role: "patient" });


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
       AVAILABILITY
       A time is open when the service runs then and at least one
       matching provider is working and not already booked.
    ========================================= */

    const candidates = () =>
        state.service ? eligibleStaff(staffMap, state.service, state.pref) : [];

    // Times on that day when a matching provider is on duty
    function workingTimes(key) {

        const service = SERVICES[state.service];

        if (!service || !service.days.includes(parseDateKey(key).getDay())) return [];

        const list = candidates();

        return generateSlots(service).filter((time) => list.some((s) => staffWorksAt(s, key, time)));
    }

    const freeAt = (key, time) => freeStaffAt(candidates(), bookings[key], key, time);

    const openTimes = (key) =>
        workingTimes(key).filter((time) => !isSlotPast(key, time) && freeAt(key, time).length > 0);


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
                <span class="service-hours">${describeDays(svc.days)} · ${describeRanges(svc.ranges)}</span>
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

        // Keep the chosen provider only if they offer this service too
        if (state.pref.kind !== "any" && candidates().length === 0) state.pref = { kind: "any" };

        renderAll();
    }


    /* =========================================
       STEP 2: PROVIDER
    ========================================= */

    function workDays(staff) {
        const days = [0, 1, 2, 3, 4, 5, 6].filter((d) => rangesFor(staff, d).length > 0);
        return days.length ? describeDays(days) : "No hours set";
    }

    function renderProviders() {

        const box = $("providerOptions");

        if (!state.service) {
            box.innerHTML = '<p class="hint">Choose a service first to see who can help you.</p>';
            return;
        }

        if (!staffLoaded) {
            box.innerHTML = '<p class="hint">Loading the clinic team...</p>';
            return;
        }

        const team = eligibleStaff(staffMap, state.service, { kind: "any" })
            .sort((a, b) => staffDisplayName(a).localeCompare(staffDisplayName(b)));

        if (team.length === 0) {
            box.innerHTML = '<p class="hint">No clinic staff offer this service yet. Please check back later or contact the clinic.</p>';
            return;
        }

        const types = Object.keys(STAFF_TYPES).filter((type) => team.some((s) => s.type === type));
        const selected = (kind, value) =>
            state.pref.kind === kind && (kind === "any" || value === (state.pref.type || state.pref.staffId));

        const option = (pref, title, sub, isOn) => `
            <button type="button" class="provider-type${isOn ? " selected" : ""}" data-pref="${pref}" aria-pressed="${isOn}">
                <strong>${title}</strong>
                <span>${sub}</span>
            </button>`;

        box.innerHTML = `
            <div class="provider-types">
                ${option("any", "Any available", "Fastest: the clinic assigns whoever is free", selected("any"))}
                ${types.map((type) => {
                    const count = team.filter((s) => s.type === type).length;
                    return option(`type:${type}`, STAFF_TYPES[type].label,
                        `${count} ${(count === 1 ? STAFF_TYPES[type].label : STAFF_TYPES[type].plural).toLowerCase()} on the team`,
                        selected("type", type));
                }).join("")}
            </div>

            <h4 class="provider-subhead">Or choose someone you've seen before</h4>

            <div class="provider-people">
                ${team.map((s) => {
                    const on = selected("person", s.id);
                    return `
                        <button type="button" class="person-card${on ? " selected" : ""}" data-pref="person:${escapeHtml(s.id)}" aria-pressed="${on}">
                            <span class="person-avatar ${escapeHtml(s.type)}">${avatarInner(staffPhotos[s.id], s.name)}</span>
                            <span class="person-text">
                                <strong>${escapeHtml(staffDisplayName(s))}</strong>
                                <small>${escapeHtml(staffTypeLabel(s.type))}${s.specialty ? ` · ${escapeHtml(s.specialty)}` : ""} · ${escapeHtml(workDays(s))}</small>
                                ${s.bio ? `<small class="person-bio">${escapeHtml(s.bio)}</small>` : ""}
                            </span>
                        </button>`;
                }).join("")}
            </div>
        `;
    }

    $("providerOptions").addEventListener("click", (event) => {

        const button = event.target.closest("[data-pref]");
        if (!button) return;

        const [kind, value] = button.dataset.pref.split(":");

        state.pref = kind === "type" ? { kind, type: value }
            : kind === "person" ? { kind, staffId: value }
            : { kind: "any" };

        // Keep the date if it still has open times with this choice
        state.time = "";
        if (state.date && openTimes(state.date).length === 0) state.date = "";

        renderAll();
    });


    /* =========================================
       STEP 3: DATES
    ========================================= */

    function renderDays() {

        const list = $("dayList");

        if (!state.service) {
            list.innerHTML = '<p class="hint">Choose a service first to see the dates available.</p>';
            return;
        }

        if (!staffLoaded || !bookingsLoaded) {
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
            const working = workingTimes(key).filter((t) => !isSlotPast(key, t));
            const open = working.length > 0 && openTimes(key).length > 0;
            const full = working.length > 0 && !open;
            const selected = key === state.date;

            if (open) anyOpen = true;

            const weekday = i === 0
                ? "Today"
                : day.toLocaleDateString("en-US", { weekday: "short" });

            html += `
                <button type="button"
                        class="day-btn${selected ? " selected" : ""}"
                        data-date="${key}"
                        aria-pressed="${selected}"
                        ${open ? "" : `disabled title="${full ? "Fully booked" : "Not available"}"`}>
                    <span class="day-name">${weekday}</span>
                    <span class="day-num">${day.getDate()}</span>
                    <span class="day-month">${full ? "Full" : day.toLocaleDateString("en-US", { month: "short" })}</span>
                </button>
            `;
        }

        list.innerHTML = (anyOpen ? "" : '<p class="hint wide">No open times in the next two weeks for this choice. Try "Any available" or another provider.</p>') + html;
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
       STEP 4: TIMES
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

        const times = workingTimes(state.date);
        const showCount = state.pref.kind !== "person";

        let available = 0;

        const button = (time) => {

            const free = freeAt(state.date, time).length;
            const past = isSlotPast(state.date, time);
            const unavailable = past || free === 0;

            if (!unavailable) available++;

            const note = past ? ""
                : free === 0 ? "<small class=\"full\">Taken</small>"
                : showCount ? `<small>${free} open</small>` : "";

            return `
                <button type="button"
                        class="slot${state.time === time ? " selected" : ""}"
                        data-time="${time}"
                        aria-pressed="${state.time === time}"
                        ${unavailable ? "disabled" : ""}>
                    ${formatTime(time)}
                    ${note}
                </button>
            `;
        };

        const group = (title, items) => items.length
            ? `<div class="slot-group"><h4>${title}</h4><div class="slot-grid">${items.map(button).join("")}</div></div>`
            : "";

        const html =
            group("Morning", times.filter((t) => toMinutes(t) < 12 * 60)) +
            group("Afternoon", times.filter((t) => toMinutes(t) >= 12 * 60));

        if (available === 0) {
            list.innerHTML = '<p class="hint">No times are available on this date. Please pick another day.</p>' + html;
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
       STEP 5: REASON + MEDICAL HISTORY
    ========================================= */

    $("reason").addEventListener("input", () => {
        $("reasonCount").textContent = `${$("reason").value.length} / ${MAX_REASON}`;
    });

    $("mhConditions").innerHTML = CONDITIONS.map((name, i) => `
        <label class="check-row">
            <input type="checkbox" value="${escapeHtml(name)}" id="mhc${i}">
            <span>${escapeHtml(name)}</span>
        </label>
    `).join("");

    const HISTORY_FIELDS = {
        allergies: "mhAllergies",
        medications: "mhMedications",
        otherCondition: "mhOther",
        surgeries: "mhSurgeries",
        notes: "mhNotes"
    };

    function collectHistory() {

        const history = {};

        Object.entries(HISTORY_FIELDS).forEach(([field, id]) => {
            const value = $(id).value.trim();
            if (value) history[field] = value;
        });

        const conditions = [...$("mhConditions").querySelectorAll("input:checked")].map((i) => i.value);
        if (conditions.length) history.conditions = conditions;

        return hasMedicalHistory(history) ? history : null;
    }

    function fillHistory(history) {

        if (!history) return;

        Object.entries(HISTORY_FIELDS).forEach(([field, id]) => {
            $(id).value = history[field] || "";
        });

        const chosen = new Set(listOf(history.conditions));

        $("mhConditions").querySelectorAll("input").forEach((input) => {
            input.checked = chosen.has(input.value);
        });

        $("historyStatus").textContent = "Filled in from your profile · check that it's still correct";
    }


    /* =========================================
       SUMMARY
    ========================================= */

    function setSummary(id, value) {
        const el = $(id);
        el.textContent = value || "Not selected";
        el.classList.toggle("empty", !value);
    }

    function providerText() {

        if (state.pref.kind === "person") return staffDisplayName(staffMap[state.pref.staffId]);
        if (state.pref.kind === "type") return `Any ${STAFF_TYPES[state.pref.type].label.toLowerCase()} (assigned for you)`;

        return "Any available (assigned for you)";
    }

    function updateSummary() {

        const service = SERVICES[state.service];

        setSummary("sumService", service ? service.name : "");
        setSummary("sumProvider", providerText());
        setSummary("sumDate", state.date ? formatDateLong(state.date) : "");
        setSummary("sumTime", state.time ? formatRange(state.time) : "");

        $("sumPatient").textContent = patient.name
            ? (patient.id ? `${patient.name} (${patient.id})` : patient.name)
            : "Loading...";

        $("confirmBtn").disabled =
            !(state.service && state.date && state.time) || state.submitting || !currentUser;

        $("confirmBtn").textContent = state.submitting ? "Sending..." : "Send Request";
    }

    function renderAll() {
        renderServices();
        renderProviders();
        renderDays();
        renderSlots();
        updateSummary();
    }


    /* =========================================
       SEND REQUEST
       The appointment and the provider's time slot are written in one
       update, and the database rules refuse a slot that's already
       taken, so two patients can never get the same provider + time.
    ========================================= */

    async function submitBooking() {

        if (!currentUser || state.submitting) return;
        if (!(state.service && state.date && state.time)) return;

        const service = SERVICES[state.service];

        // The chosen time may have passed while the page was open
        if (isSlotPast(state.date, state.time)) {
            toast("That time has already passed. Please choose another.", "error");
            state.time = "";
            renderAll();
            return;
        }

        // The patient can't be in two places at once
        if (myAppointments.some((a) => isActive(a) && a.date === state.date && a.time === state.time)) {
            toast("You already have an appointment at that time.", "error");
            return;
        }

        if (myAppointments.some((a) => isActive(a) && a.date === state.date && a.service === state.service)) {
            toast(`You already have a ${service.name} appointment on that day.`, "error");
            return;
        }

        state.submitting = true;
        updateSummary();

        try {

            // Fresh copy of who's booked that day
            const daySnap = await get(ref(db, `bookings/${state.date}`));
            const dayBookings = daySnap.val() || {};

            let free = freeStaffAt(candidates(), dayBookings, state.date, state.time);

            if (free.length === 0) {
                toast("Sorry, that time was just taken. Please pick another.", "error");
                state.time = "";
                return;
            }

            const history = collectHistory();
            const newRef = push(ref(db, "appointments"));
            let saved = null;

            // If someone grabs the same provider a moment before us, try the next one
            while (free.length && !saved) {

                const staff = state.pref.kind === "person" ? free[0] : pickStaff(free, dayBookings);
                free = free.filter((s) => s.id !== staff.id);

                const record = {
                    uid: currentUser.uid,
                    patientName: patient.name,
                    patientId: patient.id,
                    patientPhone: patient.phone,
                    patientEmail: patient.email,
                    patientRole: PAGE_ROLE,
                    service: state.service,
                    serviceName: service.name,
                    date: state.date,
                    time: state.time,
                    reason: $("reason").value.trim(),
                    medicalHistory: history,
                    providerPref: state.pref.kind === "type" ? state.pref.type : state.pref.kind,
                    requestedStaffId: state.pref.kind === "person" ? state.pref.staffId : null,
                    staffId: staff.id,
                    staffName: staffDisplayName(staff),
                    staffType: staff.type || "",
                    staffEmail: staff.email || "",
                    status: "pending",
                    createdAt: serverTimestamp(),
                    history: {
                        [push(ref(db, `appointments/${newRef.key}/history`)).key]: {
                            action: "booked",
                            by: currentUser.uid,
                            byRole: "patient",
                            byName: patient.name,
                            at: serverTimestamp(),
                            note: `Assigned to ${staffDisplayName(staff)}`
                        }
                    }
                };

                try {
                    await update(ref(db), {
                        [`appointments/${newRef.key}`]: record,
                        [`bookings/${state.date}/${staff.id}/${slotKey(state.time)}`]: newRef.key
                    });
                    saved = { id: newRef.key, ...record };
                } catch (error) {
                    if (!isDenied(error)) throw error;
                    console.warn("Slot just taken, trying another provider:", error);
                }
            }

            if (!saved) {
                toast("Sorry, that time was just taken. Please pick another.", "error");
                state.time = "";
                return;
            }

            // Remember the medical history for next time (doesn't block the booking)
            if (history && $("mhSave").checked) {
                set(ref(db, `medicalHistory/${currentUser.uid}`), { ...history, updatedAt: serverTimestamp() })
                    .catch((error) => console.warn("Could not save medical history:", error));
            }

            notifyNewRequest(saved);

            highlightId = saved.id;

            toast(`Request sent to ${saved.staffName}. You'll get an email once it's approved.`, "success");

            // Reset the form (medical history stays filled in for next time)
            state.service = "";
            state.pref = { kind: "any" };
            state.date = "";
            state.time = "";
            $("reason").value = "";
            $("reasonCount").textContent = `0 / ${MAX_REASON}`;

            activeFilter = "upcoming";
            showTab("mine");
            window.scrollTo({ top: 0, behavior: "smooth" });

            setTimeout(() => {
                highlightId = null;
                renderAppointments();
            }, 5000);

        } catch (error) {

            console.error("Booking error:", error);

            toast(
                isDenied(error)
                    ? "The request was refused. Your account may not have a student/employee profile yet."
                    : "Sorry, we couldn't send your request. Please try again.",
                "error"
            );

        } finally {

            state.submitting = false;
            renderAll();
        }
    }

    $("confirmBtn").addEventListener("click", submitBooking);


    /* =========================================
       MY APPOINTMENTS (live)
    ========================================= */

    function bucketOf(a) {

        const current = stateOf(a);

        if (["cancelled", "declined", "lapsed", "expired"].includes(current)) return "cancelled";
        if (["completed", "missed"].includes(current)) return "past";

        return startOf(a) >= new Date() ? "upcoming" : "past";
    }

    function stateNote(a, current) {

        const t = reminderTimes(a);
        const who = escapeHtml(a.staffName || "the clinic");

        switch (current) {
            case "pending":
                return `<p class="appt-note">Waiting for ${who} to approve your request.</p>`;
            case "approved":
                return `<p class="appt-note">Approved. We'll ask you to confirm you're still coming on ${escapeHtml(formatMoment(t.first))}.</p>`;
            case "awaiting":
                return `
                    <div class="confirm-box">
                        <p><strong>Are you still coming?</strong> Please confirm by ${escapeHtml(formatMoment(t.deadline))}, or this appointment will be cancelled so someone else can use the time.</p>
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

    // showHistory adds the timeline (History filter)
    function appointmentCard(a, bucket, showHistory = false) {

        const service = SERVICES[a.service];
        const name = service ? service.name : (a.serviceName || "Appointment");
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
            : (bucket !== "upcoming" && service
                ? `<button type="button" class="link-btn" data-rebook="${escapeHtml(a.service)}">Book again</button>`
                : "");

        return `
            <article class="appt-card${a.id === highlightId ? " highlight" : ""}" id="appt-${escapeHtml(a.id)}">
                <div class="appt-date">
                    <span class="month">${month}</span>
                    <span class="day">${dayNum}</span>
                </div>

                <div class="appt-info">
                    <h4>${escapeHtml(name)}</h4>
                    <p class="appt-when">${when}</p>
                    ${a.staffName ? `<p class="appt-provider">with ${escapeHtml(a.staffName)}${a.staffType ? ` · ${escapeHtml(staffTypeLabel(a.staffType))}` : ""}</p>` : ""}

                    ${stateNote(a, current)}

                    ${a.instructions && !["cancelled", "declined", "lapsed", "expired"].includes(current) ? `
                        <div class="instructions-box">
                            <span>How to prepare</span>
                            <p>${escapeHtml(a.instructions)}</p>
                        </div>` : ""}

                    ${a.reason ? `<p class="appt-reason"><strong>Reason:</strong> ${escapeHtml(a.reason)}</p>` : ""}

                    ${a.medicalHistory ? `
                        <details class="appt-history">
                            <summary>Medical history you shared</summary>
                            ${medicalHistoryHtml(a.medicalHistory)}
                        </details>` : ""}

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
            groups.history.push(a);   // History = every appointment, with its timeline
        });

        groups.history.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));

        // Soonest first for upcoming, most recent first for the rest
        groups.upcoming.sort((a, b) => startOf(a) - startOf(b));
        groups.past.sort((a, b) => startOf(b) - startOf(a));
        groups.cancelled.sort((a, b) => startOf(b) - startOf(a));

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
                history: ["No history yet", "Every request, approval, reminder and cancellation is recorded here."]
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
                toast("Thanks! Your provider knows you're coming.", "success");
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
            selectService(rebook.dataset.rebook);
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

        const service = SERVICES[a.service];
        const name = service ? service.name : (a.serviceName || "appointment");

        const hoursAway = (startOf(a) - new Date()) / 36e5;

        $("cancelDetail").innerHTML =
            `<strong>${escapeHtml(name)}</strong><br>${formatDateLong(a.date)} at ${formatTime(a.time)}` +
            (a.staffName ? ` with ${escapeHtml(a.staffName)}` : "") +
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

    function watchBookings() {

        const today = new Date();
        const last = new Date();
        last.setDate(today.getDate() + BOOKING_WINDOW_DAYS);

        onValue(
            query(ref(db, "bookings"), orderByKey(), startAt(toDateKey(today)), endAt(toDateKey(last))),
            (snapshot) => {

                bookings = snapshot.val() || {};
                bookingsLoaded = true;

                // Someone else took the time this patient was looking at
                if (state.time && !state.submitting && freeAt(state.date, state.time).length === 0) {
                    toast("The time you picked was just taken. Please choose another.", "error");
                    state.time = "";
                }

                renderDays();
                renderSlots();
                updateSummary();
            },
            (error) => {
                console.warn("Could not watch availability:", error);
                bookingsLoaded = true;
                renderDays();
                renderSlots();
                toast("Couldn't check live availability. A taken time may be refused when you send.", "error");
            }
        );
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

        // The admin and clinic staff have their own pages
        if (user.uid === ADMIN_UID) {
            window.location.replace("../admin/admin.html");
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

                const [otherSnap, staffSnap] = await Promise.all([
                    get(ref(db, `${otherFolder}/${user.uid}`)),
                    get(ref(db, `staff/${user.uid}`)).catch(() => null)
                ]);

                if (staffSnap?.exists()) {
                    window.location.replace("../staff/staff.html");
                    return;
                }

                // Not found here: maybe they belong on the other page
                if (otherSnap.exists()) {
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
        watchBookings();

        // The clinic team + saved medical history
        try {
            const [staffSnap, historySnap] = await Promise.all([
                get(ref(db, "staff")),
                get(ref(db, `medicalHistory/${user.uid}`)).catch(() => null)
            ]);

            staffMap = staffSnap.val() || {};
            fillHistory(historySnap?.val());

        } catch (error) {
            console.error("Could not load the clinic team:", error);
            toast("Couldn't load the clinic team. Please reload the page.", "error");
        }

        staffLoaded = true;

        // Photos load after the list so booking isn't held up by them
        loadAvatars(Object.keys(staffMap)).then((photos) => {
            staffPhotos = photos;
            renderProviders();
        });

        // ?service=dental arrives before the team loads: re-check the choice
        if (state.service && state.pref.kind !== "any" && candidates().length === 0) state.pref = { kind: "any" };

        renderAll();
    });


    /* =========================================
       START
       ?service=dental   opens the booking tab with that service chosen
       ?tab=mine         opens My Appointments
       ?appt=ID          opens My Appointments on that appointment
    ========================================= */

    renderAll();

    const params = new URLSearchParams(location.search);

    if (params.get("tab") === "mine" || params.get("appt")) {
        showTab("mine", false);
    } else if (params.get("service") && SERVICES[params.get("service")]) {
        selectService(params.get("service"));
    }

});
