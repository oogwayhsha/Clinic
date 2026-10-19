// ==========================================
// ADMIN / CLINIC STAFF DASHBOARD
// Every clinic staff account signs in here: approve or decline
// requests, follow the schedule, look up a patient's booking history
// and manage reasons, closures and staff accounts.
// ==========================================
import { app, auth, db } from "../firebase/firebase.js";

import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";

import {
    onAuthStateChanged,
    signOut,
    initializeAuth,
    inMemoryPersistence,
    createUserWithEmailAndPassword,
    sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

import {
    ref,
    get,
    set,
    update,
    push,
    query,
    orderByKey,
    startAt,
    onValue,
    runTransaction,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

import { ADMIN_UID, SWEEP_MS } from "../shared/config.js";

import {
    HOURS_TEXT,
    toDateKey,
    parseDateKey,
    formatTime,
    endTime,
    formatRange,
    formatDateLong,
    formatDateShort,
    formatMoment,
    slotKey,
    escapeHtml,
    statusOf,
    stateOf,
    stateLabel,
    STATE_INFO,
    startOf,
    reasonOf,
    isActive,
    reminderTimes,
    historyTimelineHtml
} from "../shared/clinic.js";

import { DEFAULT_REASONS, REASON_MAX, allReasons } from "../shared/reasons.js";
import { adminRecord } from "../shared/access.js";
import { mountBell } from "../shared/notify.js";

import {
    loadAvatar,
    saveAvatar,
    avatarInner,
    pickImage,
    shrinkImage,
    photoErrorMessage
} from "../shared/avatar.js";

import {
    CLINIC_CHANNEL,
    approveAppointment,
    declineAppointment,
    cancelAppointment,
    completeAppointment,
    markMissed,
    updateInstructions,
    sweepAppointments
} from "../shared/actions.js";


document.addEventListener("DOMContentLoaded", () => {

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
    const todayKey = () => toDateKey(new Date());

    // "1 booking", "2 bookings"
    const counted = (n, word, cls = "") =>
        `<span class="${cls}"><strong>${n}</strong> ${word}${n === 1 ? "" : "s"}</span>`;

    const badge = (a) => {
        const state = stateOf(a);
        return `<span class="badge ${STATE_INFO[state]?.cls || "pending"}">${escapeHtml(stateLabel(a, state))}</span>`;
    };

    const nameButton = (a) =>
        `<button type="button" class="name-btn" data-patient="${escapeHtml(a.uid)}" title="Open booking history">${escapeHtml(patientName(a))}</button>`;


    /* =========================================
       STATE
    ========================================= */

    let adminUser = null;
    let myRecord = {};          // admins/{uid}
    let myPhoto = null;

    let all = [];               // every appointment
    let profiles = {};          // uid -> student / employee record
    let admins = {};            // uid -> clinic staff account
    let reasonsData = null;     // bookingReasons
    let closures = {};          // clinicClosures/{date} = note
    let slotIndex = {};         // timeSlots/{date}/{HHMM} = appointment id
    let loaded = false;
    let slotsLoaded = false;
    let repaired = false;
    let busy = false;

    const filters = { range: "all", status: "all", reason: "all", role: "all", search: "" };

    let currentView = "weekly";
    let modalAppt = null;
    let instructionsOnly = false;
    let editingStaffId = null;
    let highlightId = null;

    const actor = () => ({ uid: adminUser.uid, name: myName(), role: "admin" });
    const myName = () => myRecord.name || adminUser.displayName || adminUser.email || "Clinic staff";


    /* =========================================
       LIVE DATA
    ========================================= */

    function watchData() {

        onValue(ref(db, "appointments"), (snapshot) => {
            all = Object.entries(snapshot.val() || {}).map(([id, value]) => ({ id, ...value }));
            loaded = true;
            repairSlots();
            render();
            openLinkedAppointment();
        }, (error) => {
            console.error("Failed to load appointments:", error);
            $("appointmentList").innerHTML = `
                <div class="empty-state">
                    <h4>We couldn't load the appointments</h4>
                    <p>Check your connection and that the latest database rules are published, then reload.</p>
                </div>`;
        });

        const watchProfiles = (folder, role) => onValue(ref(db, folder), (snapshot) => {
            Object.keys(profiles).forEach((uid) => { if (profiles[uid].role === role) delete profiles[uid]; });
            Object.entries(snapshot.val() || {}).forEach(([uid, p]) => { profiles[uid] = { ...p, role }; });
            if (loaded) render();
        }, (error) => console.warn(`Could not load ${folder}:`, error));

        watchProfiles("students", "student");
        watchProfiles("employees", "employee");

        onValue(ref(db, "admins"), (snapshot) => {
            admins = snapshot.val() || {};
            renderStaff();
        }, (error) => console.warn("Could not load staff accounts:", error));

        onValue(ref(db, "bookingReasons"), (snapshot) => {
            reasonsData = snapshot.val();
            if (!reasonsData) seedReasons();
            fillReasonFilters();
            renderReasonsAdmin();
        }, (error) => console.warn("Could not load reasons:", error));

        onValue(ref(db, "clinicClosures"), (snapshot) => {
            closures = snapshot.val() || {};
            renderClosures();
        }, (error) => console.warn("Could not load closures:", error));

        onValue(query(ref(db, "timeSlots"), orderByKey(), startAt(todayKey())), (snapshot) => {
            slotIndex = snapshot.val() || {};
            slotsLoaded = true;
            repairSlots();
        }, (error) => console.warn("Could not load time slots:", error));

        onValue(ref(db, ".info/connected"), (snapshot) => {
            const online = snapshot.val() === true;
            $("livePill").classList.toggle("offline", !online);
            $("livePill").lastChild.textContent = online ? " Live" : " Reconnecting...";
        });
    }

    // Upcoming pending/approved appointments must hold their slot, so the
    // booking page shows it as taken. Fills in any that don't (e.g. made
    // before this version). Runs once per page load.
    async function repairSlots() {

        if (repaired || !loaded || !slotsLoaded) return;
        repaired = true;

        const changes = {};

        all.filter((a) => isActive(a) && a.date && a.time && startOf(a) > new Date())
            .forEach((a) => {
                const key = slotKey(a.time);
                if (!slotIndex[a.date]?.[key] && !changes[`timeSlots/${a.date}/${key}`]) {
                    changes[`timeSlots/${a.date}/${key}`] = a.id;
                }
            });

        for (const [path, id] of Object.entries(changes)) {
            await set(ref(db, path), id).catch((error) => console.warn("Slot repair skipped:", path, error));
        }
    }


    /* =========================================
       FILTERS
    ========================================= */

    const STATUS_OPTIONS = [
        ["all", "All statuses"],
        ["active", "Not cancelled"],
        ["pending", "Pending approval"],
        ["approved", "Approved"],
        ["completed", "Completed"],
        ["missed", "No-show"],
        ["cancelled", "Cancelled"],
        ["declined", "Declined"]
    ];

    document.querySelectorAll(".status-select").forEach((select) => {
        STATUS_OPTIONS.forEach(([value, label]) => select.add(new Option(label, value)));
    });

    function reasonNames() {
        const names = new Set(allReasons(reasonsData).map((r) => r.name));
        if (!reasonsData) DEFAULT_REASONS.forEach((n) => names.add(n));
        all.forEach((a) => names.add(reasonOf(a)));
        return [...names].sort((a, b) => a.localeCompare(b));
    }

    function fillReasonFilters() {
        const names = reasonNames();
        document.querySelectorAll(".reason-filter").forEach((select) => {
            const current = select.value || "all";
            select.replaceChildren(new Option("All reasons", "all"));
            names.forEach((n) => select.add(new Option(n, n)));
            select.value = names.includes(current) ? current : "all";
        });
    }

    const matchesStatus = (a, status) =>
        status === "all" ||
        (status === "active" ? !["cancelled", "declined"].includes(statusOf(a)) : statusOf(a) === status);

    const matchesSearch = (a, term) =>
        !term || `${patientName(a)} ${patientId(a)} ${reasonOf(a)} ${patientEmail(a)}`.toLowerCase().includes(term);

    function filtered() {

        const today = todayKey();
        const term = filters.search.trim().toLowerCase();

        return all.filter((a) => {

            const date = a.date || "";

            if (filters.range === "today" && date !== today) return false;
            if (filters.range === "upcoming" && date < today) return false;
            if (filters.range === "past" && date >= today) return false;

            if (!matchesStatus(a, filters.status)) return false;
            if (filters.reason !== "all" && reasonOf(a) !== filters.reason) return false;
            if (filters.role !== "all" && patientRole(a) !== filters.role) return false;

            return matchesSearch(a, term);
        });
    }

    function sortList(list) {
        // Today / upcoming: soonest first. Past / all: newest first.
        const newestFirst = filters.range === "past" || filters.range === "all";
        return list.sort((a, b) => newestFirst ? startOf(b) - startOf(a) : startOf(a) - startOf(b));
    }

    // Two active appointments in one slot (only possible with old data)
    function conflicts() {
        const seen = {};
        const clash = new Set();
        all.filter(isActive).forEach((a) => {
            const key = `${a.date} ${a.time}`;
            if (seen[key]) { clash.add(a.id); clash.add(seen[key]); } else seen[key] = a.id;
        });
        return clash;
    }


    /* =========================================
       STATS (each card opens its list)
    ========================================= */

    const STAT_VIEWS = {
        today:     { range: "today",    status: "active" },
        pending:   { range: "upcoming", status: "pending" },
        approved:  { range: "upcoming", status: "approved" },
        completed: { range: "all",      status: "completed" }
    };

    function renderStats() {

        const today = todayKey();
        const pending = all.filter((a) => stateOf(a) === "pending").length;

        $("statToday").textContent = all.filter((a) => a.date === today && matchesStatus(a, "active")).length;
        $("statPending").textContent = pending;
        $("statApproved").textContent = all.filter((a) => statusOf(a) === "approved" && (a.date || "") >= today).length;
        $("statCompleted").textContent = all.filter((a) => statusOf(a) === "completed").length;

        $("pendingBadge").textContent = pending;
        $("pendingBadge").hidden = pending === 0;
    }

    function syncListControls() {
        document.querySelectorAll("#rangeFilters .filter").forEach((b) => {
            b.classList.toggle("active", b.dataset.range === filters.range);
        });
        $("statusFilter").value = filters.status;
        $("reasonFilter").value = filters.reason;
        $("roleFilter").value = filters.role;
        $("searchInput").value = filters.search;
    }

    function markStat(name) {
        document.querySelectorAll("[data-stat]").forEach((card) => {
            const on = card.dataset.stat === name;
            card.classList.toggle("active", on);
            card.setAttribute("aria-pressed", String(on));
        });
    }

    document.querySelectorAll("[data-stat]").forEach((card) => {
        card.addEventListener("click", () => {
            Object.assign(filters, { reason: "all", role: "all", search: "" }, STAT_VIEWS[card.dataset.stat]);
            syncListControls();
            markStat(card.dataset.stat);
            showView("list");
            $("view-list").scrollIntoView({ behavior: "smooth", block: "start" });
        });
    });


    /* =========================================
       APPOINTMENT ACTIONS (buttons)
    ========================================= */

    function actionsFor(a) {

        const status = statusOf(a);
        const started = startOf(a) <= new Date();
        const todayOrEarlier = (a.date || "") <= todayKey();

        if (status === "pending") return started ? ["cancel"] : ["approve", "decline"];

        if (status === "approved") {
            const actions = [];
            if (todayOrEarlier) actions.push("complete");
            if (started) actions.push("missed");
            else actions.push("instructions", "cancel");
            return actions;
        }

        return [];
    }

    const ACTION_LABELS = {
        approve:      ["primary", "Approve"],
        decline:      ["danger", "Decline"],
        instructions: ["", "Instructions"],
        complete:     ["success", "Completed"],
        missed:       ["", "No-show"],
        cancel:       ["danger", "Cancel"]
    };

    const buttonsFor = (a) => actionsFor(a).map((action) => {
        const [cls, label] = ACTION_LABELS[action];
        return `<button type="button" class="link-btn ${cls}" data-action="${action}" data-id="${escapeHtml(a.id)}">${label}</button>`;
    }).join("");

    function attendanceLine(a) {
        const state = stateOf(a);
        const t = reminderTimes(a);
        if (state === "approved") return `Confirmation request goes out ${formatMoment(t.first)}`;
        if (state === "awaiting") return `Asked to confirm · auto-cancels ${formatMoment(t.deadline)} if no reply`;
        if (state === "attending" && startOf(a) > new Date()) return "Patient confirmed they're coming";
        return "";
    }

    function card(a, clash) {

        const phone = patientPhone(a);
        const id = patientId(a);
        const role = patientRole(a);
        const email = patientEmail(a);
        const detail = patientDetail(a);
        const end = a.time ? formatTime(endTime(a.time)) : "";
        const buttons = buttonsFor(a);
        const attendance = attendanceLine(a);

        return `
            <article class="appt-card${a.id === highlightId ? " highlight" : ""}" id="appt-${escapeHtml(a.id)}">
                <div class="appt-time">
                    ${a.time ? formatTime(a.time) : "--"}
                    <small>${end ? `until ${end}` : ""}</small>
                </div>

                <div class="appt-info">
                    <h4>${nameButton(a)}</h4>

                    <div class="appt-meta">
                        <span class="type-chip ${role}">${role}</span>
                        ${id ? `<span>${escapeHtml(id)}</span>` : ""}
                        ${detail ? `<span>${escapeHtml(detail)}</span>` : ""}
                        ${phone ? `<a href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a>` : ""}
                        ${email ? `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>` : ""}
                        ${clash.has(a.id) ? '<span class="type-chip clash">Double-booked</span>' : ""}
                    </div>

                    <p class="appt-reason-title">${escapeHtml(reasonOf(a))}</p>
                    ${attendance ? `<p class="appt-handled">${escapeHtml(attendance)}</p>` : ""}
                    ${a.instructions ? `<p class="appt-reason"><strong>Instructions:</strong> ${escapeHtml(a.instructions)}</p>` : ""}
                    ${a.clinicNote ? `<p class="appt-reason"><strong>Note sent:</strong> ${escapeHtml(a.clinicNote)}</p>` : ""}
                    ${a.declineReason ? `<p class="appt-reason"><strong>Declined:</strong> ${escapeHtml(a.declineReason)}</p>` : ""}
                    ${a.handledByName ? `<p class="appt-handled">Last updated by ${escapeHtml(a.handledByName)}</p>` : ""}
                    ${a.history ? `<details class="appt-history"><summary>Timeline</summary>${historyTimelineHtml(a)}</details>` : ""}
                </div>

                <div class="appt-side">
                    ${badge(a)}
                    ${buttons ? `<div class="appt-actions">${buttons}</div>` : ""}
                </div>
            </article>
        `;
    }


    /* =========================================
       WEEKLY SCHEDULE
    ========================================= */

    function getMonday(d) {
        const date = new Date(d);
        const day = date.getDay(); // 0 is Sun, 1 is Mon... 6 is Sat
        const diff = date.getDate() - (day === 0 ? 6 : day - 1);
        const monday = new Date(date.setDate(diff));
        monday.setHours(0, 0, 0, 0);
        return monday;
    }

    let currentWeekMonday = getMonday(new Date());
    let weeklyDisplayMode = "table"; // "table" | "grid"
    const weekFilters = { status: "all", reason: "all", search: "" };

    function getWeekDays(monday) {
        const days = [];
        const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const today = todayKey();

        for (let i = 0; i < 6; i++) {
            const d = new Date(monday);
            d.setDate(monday.getDate() + i);
            const dateKey = toDateKey(d);
            days.push({
                date: d,
                dateKey,
                dayName: dayNames[i],
                displayDate: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
                isToday: dateKey === today,
                closed: closures[dateKey] || ""
            });
        }

        return days;
    }

    function filteredWeekAppointments(weekDays) {
        const dayKeys = new Set(weekDays.map((d) => d.dateKey));
        const term = weekFilters.search.trim().toLowerCase();

        return all.filter((a) => {
            if (!a.date || !dayKeys.has(a.date)) return false;
            if (!matchesStatus(a, weekFilters.status)) return false;
            if (weekFilters.reason !== "all" && reasonOf(a) !== weekFilters.reason) return false;
            return matchesSearch(a, term);
        }).sort((a, b) => startOf(a) - startOf(b));
    }

    function renderWeeklySchedule() {

        if (!loaded) return;

        const weekDays = getWeekDays(currentWeekMonday);
        const lastDay = weekDays[weekDays.length - 1].date;

        const startStr = currentWeekMonday.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const endStr = lastDay.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        $("currentWeekRange").textContent = `${startStr} – ${endStr}`;

        $("currentWeekBadge").hidden = toDateKey(currentWeekMonday) !== toDateKey(getMonday(new Date()));

        const weekList = filteredWeekAppointments(weekDays);
        const allWeekList = all.filter((a) => weekDays.some((d) => d.dateKey === a.date));
        const count = (status) => allWeekList.filter((a) => statusOf(a) === status).length;

        $("weekSummaryPills").innerHTML = `
            <span class="summary-pill total">Total: <strong>${allWeekList.length}</strong></span>
            <span class="summary-pill confirmed">Approved: <strong>${count("approved")}</strong></span>
            <span class="summary-pill pending">Pending: <strong>${count("pending")}</strong></span>
            <span class="summary-pill completed">Completed: <strong>${count("completed")}</strong></span>
        `;

        if (weeklyDisplayMode === "table") renderWeeklyTable(weekDays, weekList);
        else renderWeeklyGrid(weekDays, weekList);
    }

    function renderWeeklyTable(weekDays, weekList) {

        if (weekList.length === 0) {
            $("weeklyContentArea").innerHTML = `
                <div class="card empty-state">
                    <h4>No appointments this week</h4>
                    <p>Nothing matches your filters for ${escapeHtml($("currentWeekRange").textContent)}.</p>
                    <button type="button" class="btn-primary" data-jump-week>Jump to current week</button>
                </div>
            `;
            return;
        }

        const today = todayKey();
        const clash = conflicts();

        const rowsHtml = weekList.map((a) => {
            const id = patientId(a);
            const detail = patientDetail(a);
            const dayObj = weekDays.find((d) => d.dateKey === a.date);
            const buttons = buttonsFor(a);

            return `
                <tr class="${a.date === today ? "is-today" : ""}">
                    <td>
                        <div class="table-day-cell">
                            <strong>${escapeHtml(dayObj ? dayObj.dayName : "")}</strong>
                            <small>${escapeHtml(dayObj ? dayObj.displayDate : a.date || "")}</small>
                            ${a.date === today ? '<span class="table-today-pill">Today</span>' : ""}
                        </div>
                    </td>
                    <td><span class="table-time-pill">${a.time ? formatRange(a.time) : "--"}</span></td>
                    <td>
                        <div class="table-patient-cell">
                            ${nameButton(a)}
                            <div class="table-patient-meta">
                                <span class="type-chip ${patientRole(a)}">${patientRole(a)}</span>
                                ${clash.has(a.id) ? '<span class="type-chip clash">Double-booked</span>' : ""}
                            </div>
                        </div>
                    </td>
                    <td>
                        ${id ? `<div><strong>${escapeHtml(id)}</strong></div>` : ""}
                        ${detail ? `<small class="muted-text">${escapeHtml(detail)}</small>` : ""}
                    </td>
                    <td><span class="table-reason">${escapeHtml(reasonOf(a))}</span></td>
                    <td>${badge(a)}</td>
                    <td><div class="table-actions-cell">${buttons || '<span class="muted-text">No actions</span>'}</div></td>
                </tr>
            `;
        }).join("");

        $("weeklyContentArea").innerHTML = `
            <div class="card week-table-card">
                <div class="table-scroll-wrapper">
                    <table class="schedule-table">
                        <thead>
                            <tr>
                                <th>Day &amp; Date</th>
                                <th>Time Slot</th>
                                <th>Patient</th>
                                <th>ID / Details</th>
                                <th>Reason</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </div>
            </div>
        `;
    }

    function renderWeeklyGrid(weekDays, weekList) {

        const colsHtml = weekDays.map((day) => {
            const dayAppts = weekList.filter((a) => a.date === day.dateKey);

            const cardsHtml = day.closed && dayAppts.length === 0
                ? `<div class="col-empty-msg">Clinic closed<br><small>${escapeHtml(day.closed)}</small></div>`
                : dayAppts.length === 0
                    ? '<div class="col-empty-msg">No appointments</div>'
                    : dayAppts.map((a) => {
                        const buttons = buttonsFor(a);
                        return `
                            <div class="day-grid-card">
                                <div class="grid-card-top">
                                    <span class="grid-card-time">${a.time ? formatTime(a.time) : "--"}</span>
                                    ${badge(a)}
                                </div>
                                <div class="grid-card-patient">
                                    <h5>${nameButton(a)}</h5>
                                    <div class="grid-card-meta">
                                        <span class="type-chip ${patientRole(a)}">${patientRole(a)}</span>
                                        ${patientId(a) ? `<span>${escapeHtml(patientId(a))}</span>` : ""}
                                    </div>
                                </div>
                                <div class="grid-card-service">${escapeHtml(reasonOf(a))}</div>
                                ${buttons ? `<div class="grid-card-actions">${buttons}</div>` : ""}
                            </div>
                        `;
                    }).join("");

            return `
                <div class="week-day-col ${day.isToday ? "today" : ""}">
                    <div class="day-col-header">
                        <div class="day-col-title">
                            <strong>${escapeHtml(day.dayName)}</strong>
                            <span>${escapeHtml(day.displayDate)}${day.closed ? " · Closed" : ""}</span>
                        </div>
                        <span class="day-count-badge">${dayAppts.length}</span>
                    </div>
                    <div class="day-col-cards">${cardsHtml}</div>
                </div>
            `;
        }).join("");

        $("weeklyContentArea").innerHTML = `<div class="week-grid-board">${colsHtml}</div>`;
    }


    /* =========================================
       ALL APPOINTMENTS (list)
    ========================================= */

    function renderList() {

        if (!loaded) return;

        const list = sortList(filtered());
        const clash = conflicts();

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

        const groups = new Map();

        list.forEach((a) => {
            const key = a.date || "none";
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(a);
        });

        const today = todayKey();
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
                        <h3>${escapeHtml(label)}${closures[key] ? ` <span class="closed-tag">Clinic closed: ${escapeHtml(closures[key])}</span>` : ""}</h3>
                        <span>${items.length} appointment${items.length === 1 ? "" : "s"}</span>
                    </div>
                    <div class="appointment-list">${items.map((a) => card(a, clash)).join("")}</div>
                </section>
            `;
        }).join("");
    }


    /* =========================================
       PATIENTS + BOOKING HISTORY
    ========================================= */

    function patientSummaries() {

        const map = {};

        Object.entries(profiles).forEach(([uid, p]) => {
            map[uid] = {
                uid,
                name: p.fullName || p.name || p.email || "Unnamed",
                id: p.studentId || p.employeeId || "",
                role: p.role,
                email: p.email || "",
                appts: []
            };
        });

        all.forEach((a) => {
            if (!a.uid) return;
            if (!map[a.uid]) {
                map[a.uid] = { uid: a.uid, name: patientName(a), id: patientId(a), role: patientRole(a), email: patientEmail(a), appts: [] };
            }
            map[a.uid].appts.push(a);
        });

        return Object.values(map).map((p) => {
            const appts = p.appts;
            return {
                ...p,
                total: appts.length,
                upcoming: appts.filter((a) => isActive(a) && startOf(a) > new Date()).length,
                completed: appts.filter((a) => statusOf(a) === "completed").length,
                noShows: appts.filter((a) => statusOf(a) === "missed" || a.cancelReason === "no-confirmation").length,
                last: appts.reduce((max, a) => Math.max(max, Number(a.createdAt) || startOf(a).getTime()), 0)
            };
        });
    }

    function renderPatients() {

        if (!loaded) return;

        const term = $("patientSearch").value.trim().toLowerCase();
        const sort = $("patientSort").value;

        const list = patientSummaries()
            .filter((p) => !term || `${p.name} ${p.id} ${p.email}`.toLowerCase().includes(term))
            .sort((a, b) =>
                sort === "name" ? a.name.localeCompare(b.name)
                : sort === "visits" ? b.total - a.total
                : sort === "noshows" ? b.noShows - a.noShows || b.total - a.total
                : b.last - a.last || a.name.localeCompare(b.name));

        $("patientCount").textContent = `${list.length} patient${list.length === 1 ? "" : "s"} · open one to see their full booking history`;

        if (list.length === 0) {
            $("patientList").innerHTML = '<div class="empty-state"><h4>No patients found</h4><p>Try another name or ID.</p></div>';
            return;
        }

        $("patientList").innerHTML = `
            <div class="patient-table">
                ${list.slice(0, 300).map((p) => `
                    <button type="button" class="patient-row" data-patient="${escapeHtml(p.uid)}">
                        <span class="patient-main">
                            <strong>${escapeHtml(p.name)}</strong>
                            <small>
                                <span class="type-chip ${escapeHtml(p.role || "student")}">${escapeHtml(p.role || "student")}</span>
                                ${escapeHtml([p.id, p.email].filter(Boolean).join(" · "))}
                            </small>
                        </span>
                        <span class="patient-stats">
                            ${counted(p.total, "booking")}
                            <span><strong>${p.upcoming}</strong> upcoming</span>
                            <span><strong>${p.completed}</strong> completed</span>
                            ${counted(p.noShows, "no-show", p.noShows ? "warn" : "")}
                        </span>
                    </button>`).join("")}
            </div>`;
    }

    $("patientSearch").addEventListener("input", renderPatients);
    $("patientSort").addEventListener("change", renderPatients);

    async function openPatient(uid) {

        const p = profiles[uid] || {};
        const visits = all.filter((a) => a.uid === uid).sort((x, y) => startOf(y) - startOf(x));
        const sample = visits[0] || { uid };

        const name = p.fullName || p.name || patientName(sample);
        const role = p.role || patientRole(sample);

        $("patientTitle").textContent = name;
        openModal("patientModal");

        const info = [
            [role === "employee" ? "Employee ID" : "Student ID", p.studentId || p.employeeId || patientId(sample)],
            [role === "employee" ? "Department" : "Program", role === "employee" ? p.department : [p.program, p.yearLevel].filter(Boolean).join(" · ")],
            ["Email", p.email || patientEmail(sample)],
            ["Phone", p.phone || patientPhone(sample)],
            ["Emergency contact", [p.emergencyName, p.relationship, p.emergencyPhone].filter(Boolean).join(" · ")]
        ];

        const count = (fn) => visits.filter(fn).length;

        const render = (photo) => {
            $("patientBody").innerHTML = `
                <div class="record-head">
                    <span class="person-avatar big">${avatarInner(photo, name)}</span>
                    <div>
                        <strong>${escapeHtml(name)}</strong>
                        <span>${role === "employee" ? "Employee" : "Student"}</span>
                    </div>
                </div>

                <div class="record-grid">
                    ${info.map(([label, value]) => `
                        <div class="record-item">
                            <span>${escapeHtml(label)}</span>
                            <strong>${escapeHtml(value || "Not provided")}</strong>
                        </div>`).join("")}
                </div>

                <div class="record-stats">
                    ${counted(visits.length, "booking")}
                    <span><strong>${count((a) => statusOf(a) === "completed")}</strong> completed</span>
                    ${counted(count((a) => statusOf(a) === "missed"), "no-show", count((a) => statusOf(a) === "missed") ? "warn" : "")}
                    <span class="${count((a) => a.cancelReason === "no-confirmation") ? "warn" : ""}"><strong>${count((a) => a.cancelReason === "no-confirmation")}</strong> unconfirmed</span>
                    <span><strong>${count((a) => statusOf(a) === "cancelled" && a.cancelledBy === "patient")}</strong> cancelled by patient</span>
                </div>

                <h4 class="record-heading">Booking history</h4>
                <div class="visit-list">
                    ${visits.length === 0 ? '<p class="muted-text">No bookings yet.</p>' : visits.map((v) => `
                        <div class="visit">
                            <div class="visit-top">
                                <strong>${v.date ? escapeHtml(formatDateShort(v.date)) : "--"} · ${v.time ? formatTime(v.time) : ""}</strong>
                                ${badge(v)}
                            </div>
                            <p>${escapeHtml(reasonOf(v))}</p>
                            ${v.instructions ? `<p class="visit-reason">Instructions: ${escapeHtml(v.instructions)}</p>` : ""}
                            ${v.declineReason ? `<p class="visit-reason">Declined: ${escapeHtml(v.declineReason)}</p>` : ""}
                            ${v.clinicNote ? `<p class="visit-reason">Clinic note: ${escapeHtml(v.clinicNote)}</p>` : ""}
                            ${v.history ? `<details class="appt-history"><summary>Timeline</summary>${historyTimelineHtml(v)}</details>` : ""}
                        </div>`).join("")}
                </div>
            `;
        };

        render(null);
        const photo = await loadAvatar(uid);
        if (photo && $("patientModal").classList.contains("show")) render(photo);
    }


    /* =========================================
       ACTION HANDLERS
    ========================================= */

    const INSTRUCTION_CHIPS = [
        "Please arrive 10 minutes early and bring your school ID.",
        "Please fast for 8 hours before your visit (water is okay).",
        "Bring any previous lab results, X-rays or prescriptions.",
        "Write down the medicines you're currently taking.",
        "Bring the medical clearance form from your department.",
        "Bring your vaccination card.",
        "Wear loose, comfortable clothing."
    ];

    const detailText = (a) =>
        `<strong>${escapeHtml(patientName(a))}</strong> · ${escapeHtml(reasonOf(a))}<br>` +
        `${a.date ? escapeHtml(formatDateLong(a.date)) : ""}${a.time ? `, ${escapeHtml(formatRange(a.time))}` : ""}`;

    function openApprove(a, onlyInstructions) {

        modalAppt = a;
        instructionsOnly = onlyInstructions;

        $("approveLabel").textContent = onlyInstructions ? "PRE-APPOINTMENT INSTRUCTIONS" : "APPROVE REQUEST";
        $("approveTitle").textContent = onlyInstructions ? "Instructions for the patient" : "Approve this appointment?";
        $("approveConfirm").textContent = onlyInstructions ? "Save and notify patient" : "Approve and notify patient";
        $("approveDetail").innerHTML = detailText(a) +
            (closures[a.date] ? `<span class="warn">The clinic is marked closed that day (${escapeHtml(closures[a.date])}).</span>` : "");

        $("instructionChips").innerHTML = INSTRUCTION_CHIPS.map((text) =>
            `<button type="button" class="chip" data-chip="${escapeHtml(text)}">+ ${escapeHtml(text)}</button>`).join("");

        $("instructionsInput").value = a.instructions || "";

        openModal("approveModal");
        $("instructionsInput").focus();
    }

    $("instructionChips").addEventListener("click", (event) => {
        const chip = event.target.closest("[data-chip]");
        if (!chip) return;

        const box = $("instructionsInput");
        const text = chip.dataset.chip;

        if (!box.value.includes(text)) box.value = box.value.trim() ? `${box.value.trim()}\n${text}` : text;
        box.focus();
    });

    async function runAction(button, work, success) {
        if (busy) return;
        busy = true;
        if (button) button.disabled = true;

        try {
            await work();
            toast(success, "success");
            closeModals();
        } catch (error) {
            console.error("Action failed:", error);
            toast("That change couldn't be saved. Please try again.", "error");
        } finally {
            busy = false;
            if (button) button.disabled = false;
        }
    }

    $("approveConfirm").addEventListener("click", () => {
        const a = modalAppt;
        if (!a) return;

        runAction($("approveConfirm"),
            () => instructionsOnly
                ? updateInstructions(a, actor(), $("instructionsInput").value)
                : approveAppointment(a, actor(), { instructions: $("instructionsInput").value }),
            instructionsOnly ? "Instructions saved and sent to the patient." : `Approved. ${patientName(a)} has been notified.`);
    });

    $("declineConfirm").addEventListener("click", () => {
        const a = modalAppt;
        if (!a) return;

        runAction($("declineConfirm"),
            () => declineAppointment(a, actor(), { reason: $("declineReason").value }),
            "Request declined. The patient was notified.");
    });

    $("cancelConfirm").addEventListener("click", () => {
        const a = modalAppt;
        if (!a) return;

        runAction($("cancelConfirm"),
            () => cancelAppointment(a, actor(), { note: $("cancelNote").value }),
            "Appointment cancelled. The slot is open again.");
    });

    async function handleAppointmentClick(event) {

        if (event.target.closest("[data-jump-week]")) {
            currentWeekMonday = getMonday(new Date());
            Object.assign(weekFilters, { status: "all", reason: "all", search: "" });
            $("weekStatusFilter").value = "all";
            $("weekReasonFilter").value = "all";
            $("weekSearchInput").value = "";
            renderWeeklySchedule();
            return;
        }

        const nameBtn = event.target.closest("[data-patient]");
        if (nameBtn) {
            openPatient(nameBtn.dataset.patient);
            return;
        }

        const button = event.target.closest("[data-action]");
        if (!button || busy) return;

        const a = all.find((item) => item.id === button.dataset.id);
        if (!a) return;

        modalAppt = a;

        switch (button.dataset.action) {
            case "approve":
                openApprove(a, false);
                break;
            case "instructions":
                openApprove(a, true);
                break;
            case "decline":
                $("declineDetail").innerHTML = detailText(a);
                $("declineReason").value = "";
                openModal("declineModal");
                $("declineReason").focus();
                break;
            case "cancel":
                $("cancelDetail").innerHTML = detailText(a);
                $("cancelNote").value = "";
                openModal("cancelModal");
                $("cancelNote").focus();
                break;
            case "complete":
                runAction(button, () => completeAppointment(a, actor()), "Marked as completed.");
                break;
            case "missed":
                if (!confirm(`Mark ${patientName(a)} as a no-show?`)) return;
                runAction(button, () => markMissed(a, actor()), "Marked as a no-show.");
                break;
        }
    }

    ["appointmentList", "weeklyContentArea", "patientList"].forEach((id) => {
        $(id).addEventListener("click", handleAppointmentClick);
    });


    /* =========================================
       MODALS
    ========================================= */

    function openModal(id) {
        $(id).classList.add("show");
    }

    function closeModals() {
        document.querySelectorAll(".modal.show").forEach((m) => m.classList.remove("show"));
        modalAppt = null;
        editingStaffId = null;
    }

    document.querySelectorAll(".modal").forEach((modal) => {
        modal.addEventListener("click", (event) => {
            if (event.target === modal || event.target.closest("[data-close]")) closeModals();
        });
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeModals();
    });


    /* =========================================
       VIEWS + CONTROLS
    ========================================= */

    function showView(name) {

        currentView = name;

        document.querySelectorAll("[data-view]").forEach((button) => {
            const on = button.dataset.view === name;
            button.classList.toggle("active", on);
            button.setAttribute("aria-selected", String(on));
        });

        ["weekly", "list", "patients", "settings"].forEach((view) => {
            $(`view-${view}`).hidden = view !== name;
        });

        if (name !== "list") markStat("");

        $("exportBtn").hidden = !["weekly", "list"].includes(name);
        render();
    }

    document.querySelectorAll("[data-view]").forEach((button) => {
        button.addEventListener("click", () => showView(button.dataset.view));
    });

    // "My Account" in the header opens Settings
    ["deskProfileBtn", "profileBtn"].forEach((id) => {
        $(id)?.addEventListener("click", (event) => {
            event.preventDefault();
            showView("settings");
            $("myAccount").scrollIntoView({ behavior: "smooth", block: "start" });
        });
    });

    $("prevWeekBtn").addEventListener("click", () => {
        currentWeekMonday.setDate(currentWeekMonday.getDate() - 7);
        renderWeeklySchedule();
    });

    $("nextWeekBtn").addEventListener("click", () => {
        currentWeekMonday.setDate(currentWeekMonday.getDate() + 7);
        renderWeeklySchedule();
    });

    $("thisWeekBtn").addEventListener("click", () => {
        currentWeekMonday = getMonday(new Date());
        renderWeeklySchedule();
    });

    $("displayTableBtn").addEventListener("click", () => {
        weeklyDisplayMode = "table";
        $("displayTableBtn").classList.add("active");
        $("displayGridBtn").classList.remove("active");
        renderWeeklySchedule();
    });

    $("displayGridBtn").addEventListener("click", () => {
        weeklyDisplayMode = "grid";
        $("displayGridBtn").classList.add("active");
        $("displayTableBtn").classList.remove("active");
        renderWeeklySchedule();
    });

    $("weekStatusFilter").addEventListener("change", (e) => { weekFilters.status = e.target.value; renderWeeklySchedule(); });
    $("weekReasonFilter").addEventListener("change", (e) => { weekFilters.reason = e.target.value; renderWeeklySchedule(); });
    $("weekSearchInput").addEventListener("input", (e) => { weekFilters.search = e.target.value; renderWeeklySchedule(); });

    $("rangeFilters").addEventListener("click", (event) => {
        const button = event.target.closest(".filter");
        if (!button) return;
        filters.range = button.dataset.range;
        markStat("");
        syncListControls();
        renderList();
    });

    const listFilter = (key) => (e) => { filters[key] = e.target.value; markStat(""); renderList(); };

    $("statusFilter").addEventListener("change", listFilter("status"));
    $("reasonFilter").addEventListener("change", listFilter("reason"));
    $("roleFilter").addEventListener("change", listFilter("role"));
    $("searchInput").addEventListener("input", listFilter("search"));

    function render() {
        if (!loaded) return;
        renderStats();
        if (currentView === "weekly") renderWeeklySchedule();
        if (currentView === "list") renderList();
        if (currentView === "patients") renderPatients();
        if (currentView === "settings") renderStaff();
    }

    // admin.html?appt=ID (from a notification or email): show it in the list
    let linkHandled = false;

    function openLinkedAppointment() {

        if (linkHandled) return;

        const params = new URLSearchParams(location.search);
        const id = params.get("appt");

        if (params.get("view") === "settings") {
            linkHandled = true;
            showView("settings");
            return;
        }

        if (!id) return;

        const a = all.find((item) => item.id === id);
        if (!a) return;

        linkHandled = true;
        focusAppointment(a);
    }

    function focusAppointment(a) {
        Object.assign(filters, { range: "all", status: "all", reason: "all", role: "all", search: patientName(a) });
        syncListControls();
        highlightId = a.id;
        showView("list");
        document.getElementById(`appt-${a.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => { highlightId = null; render(); }, 6000);
    }

    window.addEventListener("bell:open", (event) => {
        const a = all.find((item) => item.id === event.detail?.apptId);
        if (a) focusAppointment(a);
    });


    /* =========================================
       SETTINGS: BOOKING REASONS
    ========================================= */

    // First visit: save the default list so it can be edited. A transaction,
    // so two staff opening the page at once can't both add it.
    async function seedReasons() {
        const data = {};
        DEFAULT_REASONS.forEach((name, order) => {
            data[push(ref(db, "bookingReasons")).key] = { name, active: true, order };
        });
        await runTransaction(ref(db, "bookingReasons"), (current) => (current ? undefined : data))
            .catch((error) => console.warn("Couldn't save the default reasons:", error));
    }

    function renderReasonsAdmin() {

        const list = allReasons(reasonsData);

        $("reasonList").innerHTML = list.length === 0
            ? '<li class="muted-text">No reasons yet. Add one above.</li>'
            : list.map((r, i) => `
                <li class="reason-row${r.active === false ? " off" : ""}" data-reason="${escapeHtml(r.id)}">
                    <input type="text" value="${escapeHtml(r.name)}" maxlength="${REASON_MAX}" aria-label="Reason name" data-rename>
                    <label class="switch-mini" title="${r.active === false ? "Hidden from patients" : "Shown to patients"}">
                        <input type="checkbox" data-toggle ${r.active === false ? "" : "checked"}>
                        <span>${r.active === false ? "Off" : "On"}</span>
                    </label>
                    <button type="button" class="icon-btn" data-move="-1" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
                    <button type="button" class="icon-btn" data-move="1" ${i === list.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
                    <button type="button" class="icon-btn danger" data-delete aria-label="Delete reason">×</button>
                </li>`).join("");
    }

    $("reasonForm").addEventListener("submit", async (event) => {
        event.preventDefault();

        const name = $("reasonName").value.trim();
        if (!name) return;

        const list = allReasons(reasonsData);

        if (list.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
            toast("That reason is already on the list.", "error");
            return;
        }

        try {
            await set(push(ref(db, "bookingReasons")), {
                name,
                active: true,
                order: list.length ? Math.max(...list.map((r) => Number(r.order) || 0)) + 1 : 0
            });
            $("reasonName").value = "";
            toast("Reason added. Patients can choose it now.", "success");
        } catch (error) {
            console.error("Add reason error:", error);
            toast("Couldn't add the reason.", "error");
        }
    });

    $("reasonList").addEventListener("change", async (event) => {

        const row = event.target.closest("[data-reason]");
        if (!row) return;

        const id = row.dataset.reason;

        try {
            if (event.target.matches("[data-toggle]")) {
                await update(ref(db, `bookingReasons/${id}`), { active: event.target.checked });
            }

            if (event.target.matches("[data-rename]")) {
                const name = event.target.value.trim();
                if (!name) { renderReasonsAdmin(); return; }
                await update(ref(db, `bookingReasons/${id}`), { name });
                toast("Reason renamed. Past appointments keep the old wording.", "success");
            }
        } catch (error) {
            console.error("Reason update error:", error);
            toast("Couldn't save that change.", "error");
            renderReasonsAdmin();
        }
    });

    $("reasonList").addEventListener("click", async (event) => {

        const row = event.target.closest("[data-reason]");
        if (!row) return;

        const list = allReasons(reasonsData);
        const index = list.findIndex((r) => r.id === row.dataset.reason);
        if (index < 0) return;

        try {
            const move = event.target.closest("[data-move]");

            if (move) {
                const other = list[index + Number(move.dataset.move)];
                if (!other) return;

                // Renumber everything so equal orders can't get stuck
                const order = list.map((r) => r.id);
                [order[index], order[index + Number(move.dataset.move)]] = [order[index + Number(move.dataset.move)], order[index]];

                const changes = {};
                order.forEach((id, i) => { changes[`bookingReasons/${id}/order`] = i; });
                await update(ref(db), changes);
                return;
            }

            if (event.target.closest("[data-delete]")) {
                if (!confirm(`Delete "${list[index].name}"? Past appointments keep it; patients just won't see it any more.`)) return;
                await set(ref(db, `bookingReasons/${list[index].id}`), null);
            }
        } catch (error) {
            console.error("Reason change error:", error);
            toast("Couldn't save that change.", "error");
        }
    });

    $("reasonList").addEventListener("keydown", (event) => {
        if (event.key === "Enter" && event.target.matches("[data-rename]")) event.target.blur();
    });


    /* =========================================
       SETTINGS: CLINIC CLOSURES
    ========================================= */

    $("hoursText").textContent = `The clinic takes appointments ${HOURS_TEXT}. Close a date (holiday, school event) and patients can't book it.`;
    $("closureDate").min = todayKey();

    function renderClosures() {

        const today = todayKey();
        const entries = Object.entries(closures)
            .filter(([date]) => date >= today)
            .sort(([a], [b]) => a.localeCompare(b));

        $("closureList").innerHTML = entries.length
            ? entries.map(([date, note]) => `
                <li class="closure-row">
                    <span><strong>${escapeHtml(formatDateLong(date))}</strong>${note ? ` · ${escapeHtml(note)}` : ""}</span>
                    <button type="button" class="link-btn danger" data-open-date="${escapeHtml(date)}">Reopen</button>
                </li>`).join("")
            : '<li class="muted-text">No upcoming closures.</li>';

        if (loaded) render();
    }

    $("closureForm").addEventListener("submit", async (event) => {
        event.preventDefault();

        const date = $("closureDate").value;

        if (!date || date < todayKey()) {
            toast("Pick a date from today onward.", "error");
            return;
        }

        try {
            await set(ref(db, `clinicClosures/${date}`), $("closureNote").value.trim() || "Clinic closed");

            const affected = all.filter((a) => a.date === date && isActive(a));
            $("closureWarning").hidden = affected.length === 0;
            $("closureWarning").textContent = affected.length
                ? `${affected.length} appointment${affected.length === 1 ? " is" : "s are"} still booked on ${formatDateLong(date)}. Cancel ${affected.length === 1 ? "it" : "them"} from All Appointments so the patient${affected.length === 1 ? "" : "s"} can rebook.`
                : "";

            $("closureDate").value = "";
            $("closureNote").value = "";
            toast("Date closed. Patients can't book it now.", "success");
        } catch (error) {
            console.error("Closure error:", error);
            toast("Couldn't close that date.", "error");
        }
    });

    $("closureList").addEventListener("click", async (event) => {
        const button = event.target.closest("[data-open-date]");
        if (!button) return;

        try {
            await set(ref(db, `clinicClosures/${button.dataset.openDate}`), null);
            $("closureWarning").hidden = true;
        } catch (error) {
            console.error("Reopen error:", error);
            toast("Couldn't reopen that date.", "error");
        }
    });


    /* =========================================
       SETTINGS: CLINIC STAFF ACCOUNTS
       New accounts are created on a separate, temporary Firebase app so
       the signed-in staff member stays signed in. The new person then
       gets a "set your password" email: nobody else knows the password.
    ========================================= */

    function renderStaff() {

        if (!adminUser) return;

        const list = Object.entries(admins)
            .filter(([uid]) => uid !== ADMIN_UID)
            .map(([uid, s]) => ({ uid, ...s }))
            .sort((a, b) => (a.active === false) - (b.active === false) || String(a.name).localeCompare(String(b.name)));

        const main = admins[ADMIN_UID] || {};

        const row = (s, isMain) => `
            <div class="staff-row${s.active === false ? " inactive" : ""}">
                <span class="person-avatar">${avatarInner(null, s.name || s.email)}</span>
                <span class="staff-main">
                    <strong>${escapeHtml(s.name || s.email || "Clinic staff")}${s.uid === adminUser.uid ? " (you)" : ""}</strong>
                    <small>${escapeHtml([s.position || (isMain ? "Main admin" : "Clinic staff"), s.email].filter(Boolean).join(" · "))}</small>
                </span>
                ${isMain ? '<span class="type-chip main">Main admin</span>' : s.active === false ? '<span class="type-chip off">No access</span>' : ""}
                ${isMain ? "" : `
                    <span class="appt-actions">
                        <button type="button" class="link-btn" data-edit-staff="${escapeHtml(s.uid)}">Edit</button>
                        <button type="button" class="link-btn" data-reset-staff="${escapeHtml(s.uid)}">Password email</button>
                        ${s.uid === adminUser.uid ? "" : `<button type="button" class="link-btn ${s.active === false ? "success" : "danger"}" data-toggle-staff="${escapeHtml(s.uid)}">${s.active === false ? "Give access" : "Remove access"}</button>`}
                    </span>`}
            </div>`;

        $("staffList").innerHTML =
            row({ uid: ADMIN_UID, name: main.name || (adminUser.uid === ADMIN_UID ? myName() : "Main admin"), email: main.email || "", position: main.position }, true) +
            (list.length ? list.map((s) => row(s, false)).join("") : '<p class="muted-text staff-empty">No other clinic staff yet. Add each nurse, doctor or staff member so they can sign in with their own account.</p>');
    }

    function openStaffModal(uid = null) {

        editingStaffId = uid;
        const s = uid ? admins[uid] : null;

        $("staffModalTitle").textContent = s ? "Edit clinic staff" : "Add clinic staff";
        $("staffSave").textContent = s ? "Save changes" : "Create account";
        $("staffNameInput").value = s?.name || "";
        $("staffEmailInput").value = s?.email || "";
        $("staffEmailInput").readOnly = Boolean(s);
        $("staffPositionInput").value = s?.position || "";
        $("staffCreateNote").hidden = Boolean(s);
        $("staffError").textContent = "";

        openModal("staffModal");
        $("staffNameInput").focus();
    }

    $("addStaffBtn").addEventListener("click", () => openStaffModal());

    function randomPassword() {
        const bytes = crypto.getRandomValues(new Uint8Array(24));
        return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 32) + "A!9";
    }

    async function createLogin(email) {

        const temp = initializeApp(app.options, `staff-create-${Date.now()}`);

        try {
            const tempAuth = initializeAuth(temp, { persistence: inMemoryPersistence });
            const cred = await createUserWithEmailAndPassword(tempAuth, email, randomPassword());
            await signOut(tempAuth);
            return cred.user.uid;
        } finally {
            await deleteApp(temp);
        }
    }

    $("staffSave").addEventListener("click", async () => {

        const name = $("staffNameInput").value.trim();
        const email = $("staffEmailInput").value.trim().toLowerCase();
        const position = $("staffPositionInput").value.trim();
        const uid = editingStaffId;

        $("staffError").textContent = "";

        if (name.length < 2) { $("staffError").textContent = "Enter the person's name."; return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $("staffError").textContent = "Enter a valid email address."; return; }

        $("staffSave").disabled = true;

        try {

            if (uid) {
                await update(ref(db, `admins/${uid}`), { name, position: position || null });
                toast("Staff details saved.", "success");
            } else {
                const newUid = await createLogin(email);

                await set(ref(db, `admins/${newUid}`), {
                    name,
                    email,
                    position: position || null,
                    active: true,
                    createdAt: serverTimestamp(),
                    createdBy: adminUser.uid
                });

                await sendPasswordResetEmail(auth, email);

                toast(`${name} was added. They'll get an email to set their password, then log in as "Admin".`, "success");
            }

            closeModals();

        } catch (error) {

            console.error("Staff save error:", error);

            $("staffError").textContent =
                error.code === "auth/email-already-in-use" ? "An account already uses this email (maybe a student/employee account). Use a different email."
                : error.code === "auth/invalid-email" ? "That email address isn't valid."
                : error.code === "auth/operation-not-allowed" ? "Email/password sign-in is turned off in Firebase Authentication."
                : "Couldn't save. Check your connection and the database rules.";

        } finally {
            $("staffSave").disabled = false;
        }
    });

    $("staffList").addEventListener("click", async (event) => {

        const edit = event.target.closest("[data-edit-staff]");
        const reset = event.target.closest("[data-reset-staff]");
        const toggle = event.target.closest("[data-toggle-staff]");

        if (edit) {
            openStaffModal(edit.dataset.editStaff);
            return;
        }

        if (reset) {
            const s = admins[reset.dataset.resetStaff];
            if (!s?.email) return;

            try {
                await sendPasswordResetEmail(auth, s.email);
                toast(`Password email sent to ${s.email}.`, "success");
            } catch (error) {
                console.error("Reset email error:", error);
                toast("Couldn't send the email.", "error");
            }
            return;
        }

        if (toggle) {
            const uid = toggle.dataset.toggleStaff;
            const s = admins[uid];
            const remove = s.active !== false;

            if (remove && !confirm(`Remove ${s.name || s.email}'s access? They won't be able to open the admin page any more.`)) return;

            try {
                await update(ref(db, `admins/${uid}`), { active: !remove });
                toast(remove ? "Access removed." : "Access given back.", "success");
            } catch (error) {
                console.error("Toggle staff error:", error);
                toast("Couldn't update the account.", "error");
            }
        }
    });


    /* =========================================
       SETTINGS: MY ACCOUNT
    ========================================= */

    function renderMyAccount() {
        $("myAvatar").innerHTML = avatarInner(myPhoto, myName());
        $("myPhotoBtn").textContent = myPhoto ? "Change photo" : "Add a photo";
        $("myPhotoRemove").hidden = !myPhoto;
        $("myEmail").textContent = `Login email: ${adminUser.email || ""}`;
    }

    $("mySaveBtn").addEventListener("click", async () => {

        const name = $("myName").value.trim();

        if (name.length < 2) {
            toast("Please enter your name.", "error");
            return;
        }

        $("mySaveBtn").disabled = true;

        try {
            const changes = { name, position: $("myPosition").value.trim() || null, email: adminUser.email || null };
            if (adminUser.uid === ADMIN_UID) changes.active = true;

            await update(ref(db, `admins/${adminUser.uid}`), changes);
            myRecord = { ...myRecord, ...changes };

            setGreeting();
            renderMyAccount();
            toast("Your details are saved.", "success");
        } catch (error) {
            console.error("Account save error:", error);
            toast("Couldn't save your details.", "error");
        } finally {
            $("mySaveBtn").disabled = false;
        }
    });

    async function changeMyPhoto(photo) {
        try {
            await saveAvatar(adminUser.uid, photo);
            myPhoto = photo;
            renderMyAccount();
            toast(photo ? "Photo updated." : "Photo removed.", "success");
        } catch (error) {
            console.error("Photo error:", error);
            toast(photoErrorMessage(error), "error");
        }
    }

    $("myPhotoBtn").addEventListener("click", async () => {
        const file = await pickImage();
        if (!file) return;

        try {
            await changeMyPhoto(await shrinkImage(file));
        } catch (error) {
            toast(photoErrorMessage(error), "error");
        }
    });

    $("myPhotoRemove").addEventListener("click", () => {
        if (confirm("Remove your profile photo?")) changeMyPhoto(null);
    });

    $("myPasswordBtn").addEventListener("click", async () => {
        try {
            await sendPasswordResetEmail(auth, adminUser.email);
            toast(`Password link sent to ${adminUser.email}. Check your inbox (and spam).`, "success");
        } catch (error) {
            console.error("Password email error:", error);
            toast("Couldn't send the email. Please try again later.", "error");
        }
    });

    function setGreeting() {
        const hour = new Date().getHours();
        const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
        $("greeting").textContent = `${hello}, ${myName().split(/\s+/)[0]}`;
    }


    /* =========================================
       EXPORT CSV (whatever the current view shows)
    ========================================= */

    // Stops spreadsheet apps from running text that starts with = + - @ as a formula
    function csvCell(value) {
        let text = String(value ?? "");
        if (/^[=+\-@]/.test(text)) text = "'" + text;
        return `"${text.replace(/"/g, '""')}"`;
    }

    $("exportBtn").addEventListener("click", () => {

        const isWeekly = currentView === "weekly";
        const list = isWeekly
            ? filteredWeekAppointments(getWeekDays(currentWeekMonday))
            : sortList(filtered());

        if (list.length === 0) {
            toast("There is nothing to export for the current view.", "error");
            return;
        }

        const header = ["Date", "Day", "Time", "Reason", "Patient", "Type", "ID", "Program / Department", "Email", "Phone", "Status", "Attendance", "Instructions", "Note", "Handled by"];

        const rows = list.map((a) => [
            a.date || "",
            a.date ? parseDateKey(a.date).toLocaleDateString("en-US", { weekday: "long" }) : "",
            a.time ? formatRange(a.time) : "",
            reasonOf(a),
            patientName(a),
            patientRole(a),
            patientId(a),
            patientDetail(a),
            patientEmail(a),
            patientPhone(a),
            stateLabel(a),
            a.attendance === "confirmed" ? "Confirmed" : (statusOf(a) === "approved" ? "Not confirmed yet" : ""),
            a.instructions || "",
            a.clinicNote || a.declineReason || "",
            a.handledByName || ""
        ]);

        const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");

        // BOM so Excel reads accented names correctly
        const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = url;
        link.download = isWeekly
            ? `weekly-schedule-${toDateKey(currentWeekMonday)}.csv`
            : `appointments-${todayKey()}.csv`;
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
       AUTHENTICATION: clinic staff only
    ========================================= */

    onAuthStateChanged(auth, async (user) => {

        if (!user) {
            window.location.href = "../login/login.html";
            return;
        }

        const record = user.uid === ADMIN_UID ? (await adminRecord(user.uid)) || {} : await adminRecord(user.uid);

        if (user.uid !== ADMIN_UID && record?.active !== true) {

            // Students / employees: back to their own appointments page
            let destination = "../student/st-appointment.html";

            try {
                const employeeSnap = await get(ref(db, `employees/${user.uid}`));
                if (employeeSnap.exists()) destination = "../employee/em-appointment.html";
            } catch (error) {
                console.warn("Could not check account type:", error);
            }

            if (record) {
                $("accessCheck").innerHTML = `
                    <h4>Your admin access was removed</h4>
                    <p>Please ask the main clinic admin if you still need access.</p>`;
                return;
            }

            window.location.replace(destination);
            return;
        }

        adminUser = user;
        myRecord = record || {};

        $("accessCheck").hidden = true;
        $("adminContent").hidden = false;

        $("myName").value = myRecord.name || user.displayName || "";
        $("myPosition").value = myRecord.position || "";
        setGreeting();
        renderMyAccount();

        loadAvatar(user.uid).then((photo) => {
            myPhoto = photo;
            renderMyAccount();
        });

        // Own notifications + the clinic's shared inbox
        mountBell(user.uid, [$("bellSlotDesktop"), $("bellSlotMobile")], { channels: [user.uid, CLINIC_CHANNEL] });

        watchData();

        // The admin page also sends due reminders / cancels unconfirmed visits
        setInterval(() => {
            if (loaded && !document.hidden) {
                sweepAppointments(all);
                render();
            }
        }, SWEEP_MS);
    });

});
