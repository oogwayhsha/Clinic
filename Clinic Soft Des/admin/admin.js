// ==========================================
// ADMIN: oversee all appointments + manage the clinic staff
// ==========================================
import { app, auth, db } from "../firebase/firebase.js";


import { DEFAULT_REASONS } from "../shared/reasons.js";


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
    onValue,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

import { ADMIN_UID, SWEEP_MS } from "../shared/config.js";

import {
    SERVICES,
    STAFF_TYPES,
    DEFAULT_AVAILABILITY,
    toDateKey,
    parseDateKey,
    formatTime,
    endTime,
    formatDateLong,
    escapeHtml,
    describeDays,
    rangesFor,
    staffDisplayName,
    staffTypeLabel,
    statusOf,
    stateOf,
    stateLabel,
    STATE_INFO,
    startOf,
    historyTimelineHtml
} from "../shared/clinic.js";

import { loadAvatars, avatarInner } from "../shared/avatar.js";
import { mountBell } from "../shared/notify.js";

import {
    approveAppointment,
    cancelAppointment,
    completeAppointment,
    markMissed,
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
    const providerName = (a) => a.staffName || (a.staffId && staff[a.staffId] ? staffDisplayName(staff[a.staffId]) : "Unassigned");
    const whenOf = (a) => startOf(a);
    const serviceName = (a) => SERVICES[a.service]?.name || a.serviceName || "Appointment";

    // Filters use the stored status (pending / approved / ...),
    // badges show the live state (e.g. "Needs confirmation")
    const badge = (a) => {
        const state = stateOf(a);
        return `<span class="badge ${STATE_INFO[state]?.cls || "pending"}">${escapeHtml(stateLabel(a, state))}</span>`;
    };


    /* =========================================
       STATE
    ========================================= */

    let adminUser = null;
    let adminName = "";

    let all = [];
    let profiles = {};         // uid -> student / employee record
    let staff = {};            // uid -> clinic staff record
    let staffPhotos = {};      // uid -> photo
    let loaded = false;
    let busy = false;          // an action is being saved

    const filters = { range: "all", status: "all", service: "all", role: "all", provider: "all", search: "" };

    let pendingCancel = null;
    let editingStaffId = null;

    const actor = () => ({ uid: adminUser.uid, name: adminName, role: "admin" });


    /* =========================================
       LOAD
       Appointments + staff are live; patient profiles are read once.
    ========================================= */

    async function loadProfiles() {

        const [studentSnap, employeeSnap] = await Promise.all([
            get(ref(db, "students")),
            get(ref(db, "employees"))
        ]);

        profiles = {};

        Object.entries(studentSnap.val() || {}).forEach(([uid, p]) => {
            profiles[uid] = { ...p, role: "student" };
        });

        Object.entries(employeeSnap.val() || {}).forEach(([uid, p]) => {
            profiles[uid] = { ...p, role: "employee" };
        });
    }

    function showLoadError() {
        $("appointmentList").innerHTML = `
            <div class="empty-state">
                <h4>We couldn't load the appointments</h4>
                <p>Check your connection and that the latest database rules are published, then reload.</p>
            </div>
        `;
        $("resultCount").textContent = "";
    }

    function watchData() {

        onValue(ref(db, "appointments"), (snapshot) => {
            all = Object.entries(snapshot.val() || {}).map(([id, value]) => ({ id, ...value }));
            loaded = true;
            render();
        }, (error) => {
            console.error("Failed to load appointments:", error);
            showLoadError();
        });

        onValue(ref(db, "staff"), (snapshot) => {
            staff = snapshot.val() || {};
            fillProviderFilters();
            renderStaff();
            loadAvatars(Object.keys(staff)).then((photos) => {
                staffPhotos = photos;
                renderStaff();
            });
            if (loaded) render();
        }, (error) => console.error("Failed to load staff:", error));
    }


    /* =========================================
       FILTER + RENDER
    ========================================= */

    function fillProviderFilters() {

        const options = Object.entries(staff)
            .sort(([, a], [, b]) => staffDisplayName(a).localeCompare(staffDisplayName(b)))
            .map(([id, s]) => `<option value="${escapeHtml(id)}">${escapeHtml(staffDisplayName(s))}</option>`)
            .join("");

        ["providerFilter", "weekProviderFilter"].forEach((id) => {
            const select = $(id);
            const current = select.value;
            select.innerHTML = `<option value="all">All providers</option><option value="none">Unassigned</option>${options}`;
            select.value = [...select.options].some((o) => o.value === current) ? current : "all";
        });
    }

    const matchesProvider = (a, provider) =>
        provider === "all" || (provider === "none" ? !a.staffId : a.staffId === provider);

    const matchesSearch = (a, term) =>
        !term || `${patientName(a)} ${patientId(a)} ${serviceName(a)} ${providerName(a)}`.toLowerCase().includes(term);

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
            if (!matchesProvider(a, filters.provider)) return false;

            return matchesSearch(a, term);
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

        $("statToday").textContent = all.filter((a) => a.date === today && !["cancelled", "declined"].includes(statusOf(a))).length;
        $("statPending").textContent = all.filter((a) => stateOf(a) === "pending").length;
        $("statConfirmed").textContent = all.filter((a) => statusOf(a) === "approved" && (a.date || "") >= today).length;
        $("statCompleted").textContent = all.filter((a) => statusOf(a) === "completed").length;
    }

    // Which buttons make sense for this appointment right now
    function actionsFor(a) {

        const status = statusOf(a);
        const now = new Date();
        const started = whenOf(a) <= now;
        const todayOrEarlier = (a.date || "") <= toDateKey(now);

        if (status === "pending") {
            return started ? ["cancel"] : ["approve", "cancel"];
        }

        if (status === "approved") {
            const actions = [];
            if (todayOrEarlier) actions.push("complete");
            actions.push(started ? "missed" : "cancel");
            return actions;
        }

        return [];
    }

    const ACTION_BUTTONS = {
        approve:  '<button type="button" class="link-btn primary" data-action="approve" data-id="__ID__">Approve</button>',
        complete: '<button type="button" class="link-btn success" data-action="complete" data-id="__ID__">Mark completed</button>',
        missed:   '<button type="button" class="link-btn" data-action="missed" data-id="__ID__">Mark no-show</button>',
        cancel:   '<button type="button" class="link-btn danger" data-action="cancel" data-id="__ID__">Cancel</button>'
    };

    const buttonsFor = (a) => actionsFor(a)
        .map((action) => ACTION_BUTTONS[action].replace("__ID__", escapeHtml(a.id)))
        .join("");

    function card(a) {

        const phone = patientPhone(a);
        const id = patientId(a);
        const role = patientRole(a);
        const email = patientEmail(a);
        const detail = patientDetail(a);

        const end = a.time ? formatTime(endTime(a.time)) : "";
        const buttons = buttonsFor(a);

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

                    <p class="appt-provider">with ${escapeHtml(providerName(a))}</p>

                    ${a.reason ? `<p class="appt-reason">${escapeHtml(a.reason)}</p>` : ""}
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
       WEEKLY SCHEDULE LOGIC
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
    let currentViewMode = "weekly"; // "weekly" | "list" | "staff"
    let weeklyDisplayMode = "table"; // "table" | "grid"
    const weekFilters = { status: "all", service: "all", provider: "all", search: "" };

    function getWeekDays(monday) {
        const days = [];
        const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const todayKey = toDateKey(new Date());

        for (let i = 0; i < 6; i++) {
            const d = new Date(monday);
            d.setDate(monday.getDate() + i);
            const dateKey = toDateKey(d);
            days.push({
                date: d,
                dateKey,
                dayName: dayNames[i],
                displayDate: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
                fullDate: d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
                isToday: dateKey === todayKey
            });
        }

        // Check if there are Sunday appointments in this week
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        const sunKey = toDateKey(sunday);
        const hasSundayAppointments = all.some((a) => a.date === sunKey);

        if (hasSundayAppointments) {
            days.push({
                date: sunday,
                dateKey: sunKey,
                dayName: "Sunday",
                displayDate: sunday.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
                fullDate: sunday.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
                isToday: sunKey === todayKey
            });
        }

        return days;
    }

    function filteredWeekAppointments(weekDays) {
        const dayKeys = new Set(weekDays.map((d) => d.dateKey));
        const term = weekFilters.search.trim().toLowerCase();

        return all.filter((a) => {
            if (!a.date || !dayKeys.has(a.date)) return false;

            if (weekFilters.status !== "all" && statusOf(a) !== weekFilters.status) return false;
            if (weekFilters.service !== "all" && a.service !== weekFilters.service) return false;
            if (!matchesProvider(a, weekFilters.provider)) return false;

            return matchesSearch(a, term);
        }).sort((a, b) => whenOf(a) - whenOf(b));
    }

    function renderWeeklySchedule() {
        if (!loaded) return;

        const weekDays = getWeekDays(currentWeekMonday);
        const lastDay = weekDays[weekDays.length - 1].date;

        const startStr = currentWeekMonday.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const endStr = lastDay.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        $("currentWeekRange").textContent = `${startStr} – ${endStr}`;

        const thisWeekMon = getMonday(new Date());
        const isThisWeek = toDateKey(currentWeekMonday) === toDateKey(thisWeekMon);
        $("currentWeekBadge").hidden = !isThisWeek;

        // Appointments in this week
        const weekList = filteredWeekAppointments(weekDays);

        // Stats summary for the selected week
        const allWeekList = all.filter((a) => weekDays.some((d) => d.dateKey === a.date));
        const count = (status) => allWeekList.filter((a) => statusOf(a) === status).length;

        $("weekSummaryPills").innerHTML = `
            <span class="summary-pill total">Total: <strong>${allWeekList.length}</strong></span>
            <span class="summary-pill confirmed">Approved: <strong>${count("approved")}</strong></span>
            <span class="summary-pill pending">Pending: <strong>${count("pending")}</strong></span>
            <span class="summary-pill completed">Completed: <strong>${count("completed")}</strong></span>
        `;

        if (weeklyDisplayMode === "table") {
            renderWeeklyTable(weekDays, weekList);
        } else {
            renderWeeklyGrid(weekDays, weekList);
        }
    }

    function renderWeeklyTable(weekDays, weekList) {
        if (weekList.length === 0) {
            $("weeklyContentArea").innerHTML = `
                <div class="card empty-state">
                    <h4>No appointments scheduled for this week</h4>
                    <p>There are no appointments matching your filters for ${$("currentWeekRange").textContent}.</p>
                    <button type="button" class="btn-primary" id="jumpThisWeekBtn">Jump to Current Week</button>
                </div>
            `;
            const jumpBtn = $("jumpThisWeekBtn");
            if (jumpBtn) {
                jumpBtn.addEventListener("click", () => {
                    currentWeekMonday = getMonday(new Date());
                    Object.assign(weekFilters, { status: "all", service: "all", provider: "all", search: "" });
                    $("weekStatusFilter").value = "all";
                    $("weekServiceFilter").value = "all";
                    $("weekProviderFilter").value = "all";
                    $("weekSearchInput").value = "";
                    renderWeeklySchedule();
                });
            }
            return;
        }

        const todayKey = toDateKey(new Date());

        const rowsHtml = weekList.map((a) => {
            const phone = patientPhone(a);
            const id = patientId(a);
            const role = patientRole(a);
            const email = patientEmail(a);
            const detail = patientDetail(a);
            const isToday = a.date === todayKey;

            const end = a.time ? formatTime(endTime(a.time)) : "";
            const dayObj = weekDays.find((d) => d.dateKey === a.date);
            const dayLabel = dayObj ? dayObj.dayName : "Unknown";
            const dateLabel = dayObj ? dayObj.displayDate : (a.date || "");

            const buttons = buttonsFor(a);

            return `
                <tr class="${isToday ? "is-today" : ""}">
                    <td>
                        <div class="table-day-cell">
                            <strong>${escapeHtml(dayLabel)}</strong>
                            <small>${escapeHtml(dateLabel)}</small>
                            ${isToday ? `<span class="table-today-pill">Today</span>` : ""}
                        </div>
                    </td>
                    <td>
                        <span class="table-time-pill">${a.time ? formatTime(a.time) : "--"}${end ? ` – ${end}` : ""}</span>
                    </td>
                    <td>
                        <div class="table-patient-cell">
                            <strong>${escapeHtml(patientName(a))}</strong>
                            <div class="table-patient-meta">
                                <span class="type-chip ${role}">${role}</span>
                            </div>
                        </div>
                    </td>
                    <td>
                        ${id ? `<div><strong>${escapeHtml(id)}</strong></div>` : ""}
                        ${detail ? `<small style="color:var(--muted)">${escapeHtml(detail)}</small>` : ""}
                    </td>
                    <td>
                        <span class="table-service-pill ${escapeHtml(a.service || "consultation")}">
                            ${escapeHtml(serviceName(a))}
                        </span>
                    </td>
                    <td>
                        <span class="table-provider">${escapeHtml(providerName(a))}</span>
                    </td>
                    <td>
                        <div class="table-contact-links">
                            ${phone ? `<a href="tel:${escapeHtml(phone)}" title="Call">${escapeHtml(phone)}</a>` : ""}
                            ${email ? `<a href="mailto:${escapeHtml(email)}" title="Email">${escapeHtml(email)}</a>` : ""}
                            ${!phone && !email ? `<span style="color:var(--muted)">--</span>` : ""}
                        </div>
                    </td>
                    <td>
                        ${badge(a)}
                    </td>
                    <td>
                        <div class="table-actions-cell">
                            ${buttons || `<span style="color:var(--muted); font-size:12px;">No actions</span>`}
                        </div>
                    </td>
                </tr>
            `;
        }).join("");

        $("weeklyContentArea").innerHTML = `
            <div class="card week-table-card">
                <div class="table-scroll-wrapper">
                    <table class="schedule-table">
                        <thead>
                            <tr>
                                <th>Day & Date</th>
                                <th>Time Slot</th>
                                <th>Patient</th>
                                <th>ID / Details</th>
                                <th>Service</th>
                                <th>Provider</th>
                                <th>Contact</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    function renderWeeklyGrid(weekDays, weekList) {
        const colsHtml = weekDays.map((day) => {
            const dayAppts = weekList.filter((a) => a.date === day.dateKey);

            const cardsHtml = dayAppts.length === 0
                ? `<div class="col-empty-msg">No appointments</div>`
                : dayAppts.map((a) => {
                    const role = patientRole(a);
                    const id = patientId(a);
                    const end = a.time ? formatTime(endTime(a.time)) : "";
                    const buttons = buttonsFor(a);

                    return `
                        <div class="day-grid-card">
                            <div class="grid-card-top">
                                <span class="grid-card-time">${a.time ? formatTime(a.time) : "--"}${end ? ` until ${end}` : ""}</span>
                                ${badge(a)}
                            </div>
                            <div class="grid-card-patient">
                                <h5>${escapeHtml(patientName(a))}</h5>
                                <div class="grid-card-meta">
                                    <span class="type-chip ${role}">${role}</span>
                                    ${id ? `<span>${escapeHtml(id)}</span>` : ""}
                                </div>
                            </div>
                            <div class="grid-card-service">
                                ${escapeHtml(serviceName(a))} · ${escapeHtml(providerName(a))}
                            </div>
                            ${buttons ? `<div class="grid-card-actions">${buttons}</div>` : ""}
                        </div>
                    `;
                }).join("");

            return `
                <div class="week-day-col ${day.isToday ? "today" : ""}">
                    <div class="day-col-header">
                        <div class="day-col-title">
                            <strong>${escapeHtml(day.dayName)}</strong>
                            <span>${escapeHtml(day.displayDate)}</span>
                        </div>
                        <span class="day-count-badge">${dayAppts.length}</span>
                    </div>
                    <div class="day-col-cards">
                        ${cardsHtml}
                    </div>
                </div>
            `;
        }).join("");

        $("weeklyContentArea").innerHTML = `
            <div class="week-grid-board">
                ${colsHtml}
            </div>
        `;
    }

    function renderList() {
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

    function render() {
        if (!loaded) return;
        renderStats();
        renderWeeklySchedule();
        renderList();
        renderStaff();
    }


    /* =========================================
       FILTER & VIEW SWITCHER CONTROLS
    ========================================= */

    const VIEWS = {
        weekly: { button: "viewWeeklyScheduleBtn", section: "weeklyScheduleSection" },
        list: { button: "viewListViewBtn", section: "listViewSection" },
        staff: { button: "viewStaffBtn", section: "staffSection" }
    };

    function showView(name) {
        currentViewMode = name;

        Object.entries(VIEWS).forEach(([key, view]) => {
            $(view.button).classList.toggle("active", key === name);
            $(view.button).setAttribute("aria-selected", String(key === name));
            $(view.section).hidden = key !== name;
        });

        $("exportBtn").hidden = name === "staff";
        render();
    }

    Object.entries(VIEWS).forEach(([name, view]) => {
        $(view.button).addEventListener("click", () => showView(name));
    });

    // Week Navigation
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

    // Weekly Display Mode (Table vs Grid)
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

    // Week Quick Filters
    $("weekStatusFilter").addEventListener("change", (e) => { weekFilters.status = e.target.value; renderWeeklySchedule(); });
    $("weekServiceFilter").addEventListener("change", (e) => { weekFilters.service = e.target.value; renderWeeklySchedule(); });
    $("weekProviderFilter").addEventListener("change", (e) => { weekFilters.provider = e.target.value; renderWeeklySchedule(); });
    $("weekSearchInput").addEventListener("input", (e) => { weekFilters.search = e.target.value; renderWeeklySchedule(); });

    // List view filters
    $("rangeFilters").addEventListener("click", (event) => {

        const button = event.target.closest(".filter");
        if (!button) return;

        filters.range = button.dataset.range;

        document.querySelectorAll("#rangeFilters .filter").forEach((b) => {
            b.classList.toggle("active", b === button);
        });

        renderList();
    });

    $("statusFilter").addEventListener("change", (e) => { filters.status = e.target.value; renderList(); });
    $("serviceFilter").addEventListener("change", (e) => { filters.service = e.target.value; renderList(); });
    $("roleFilter").addEventListener("change", (e) => { filters.role = e.target.value; renderList(); });
    $("providerFilter").addEventListener("change", (e) => { filters.provider = e.target.value; renderList(); });
    $("searchInput").addEventListener("input", (e) => { filters.search = e.target.value; renderList(); });

    $("refreshBtn").addEventListener("click", async () => {
        try {
            await loadProfiles();
            render();
            toast("Patient details refreshed. Appointments update live.");
        } catch (error) {
            console.error("Refresh error:", error);
            toast("Couldn't refresh patient details.", "error");
        }
    });


    /* =========================================
       ACTIONS: approve / complete / no-show / cancel
    ========================================= */

    async function handleAppointmentAction(event) {

        const button = event.target.closest("[data-action]");
        if (!button || busy) return;

        const a = all.find((item) => item.id === button.dataset.id);
        if (!a) return;

        const action = button.dataset.action;

        if (action === "cancel") {
            openCancelModal(a);
            return;
        }

        if (action === "missed" && !confirm(`Mark ${patientName(a)} as a no-show?`)) return;

        button.disabled = true;
        busy = true;

        try {
            if (action === "approve") {
                await approveAppointment(a, actor());
                toast("Approved. The patient was notified.", "success");
            } else if (action === "complete") {
                await completeAppointment(a, actor());
                toast("Marked as completed.", "success");
            } else if (action === "missed") {
                await markMissed(a, actor());
                toast("Marked as a no-show.", "success");
            }
        } catch (error) {
            console.error("Update error:", error);
            toast("That change couldn't be saved. Please try again.", "error");
            button.disabled = false;
        } finally {
            busy = false;
        }
    }

    $("appointmentList").addEventListener("click", handleAppointmentAction);
    $("weeklyContentArea").addEventListener("click", handleAppointmentAction);


    /* =========================================
       CANCEL MODAL
    ========================================= */

    function openCancelModal(a) {

        pendingCancel = a;

        $("cancelDetail").innerHTML =
            `<strong>${escapeHtml(patientName(a))}</strong><br>` +
            `${escapeHtml(serviceName(a))} · ${a.date ? formatDateLong(a.date) : ""} at ${a.time ? formatTime(a.time) : ""}` +
            ` · ${escapeHtml(providerName(a))}`;

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
        if (event.key === "Escape") {
            closeCancelModal();
            closeStaffModal();
        }
    });

    $("cancelConfirm").addEventListener("click", async () => {

        const a = pendingCancel;

        if (!a || busy) return;

        busy = true;
        $("cancelConfirm").disabled = true;

        try {
            await cancelAppointment(a, actor(), { note: $("cancelNote").value });
            closeCancelModal();
            toast("Appointment cancelled. The time is open again.", "success");
        } catch (error) {
            console.error("Cancel error:", error);
            toast("That change couldn't be saved. Please try again.", "error");
        } finally {
            busy = false;
            $("cancelConfirm").disabled = false;
        }
    });


    /* =========================================
       CLINIC STAFF
       New staff accounts are created on a separate, temporary Firebase
       app so the admin stays signed in. The new staff member then gets
       a "set your password" email: the admin never knows the password.
    ========================================= */

    function staffWorkload(id) {
        const today = toDateKey(new Date());
        const upcoming = all.filter((a) => a.staffId === id && (a.date || "") >= today);
        return {
            pending: upcoming.filter((a) => statusOf(a) === "pending").length,
            approved: upcoming.filter((a) => statusOf(a) === "approved").length,
            completed: all.filter((a) => a.staffId === id && statusOf(a) === "completed").length
        };
    }

    function renderStaff() {

        const list = Object.entries(staff)
            .map(([id, s]) => ({ id, ...s }))
            .sort((a, b) => (a.active === false) - (b.active === false) || staffDisplayName(a).localeCompare(staffDisplayName(b)));

        if (list.length === 0) {
            $("staffList").innerHTML = `
                <div class="empty-state">
                    <h4>No clinic staff yet</h4>
                    <p>Patients can't book until at least one doctor, nurse or dentist is added.</p>
                    <button type="button" class="btn-primary" data-add-staff>Add the first staff member</button>
                </div>`;
            return;
        }

        $("staffList").innerHTML = `<div class="staff-grid">${list.map((s) => {
            const load = staffWorkload(s.id);
            const days = [0, 1, 2, 3, 4, 5, 6].filter((d) => rangesFor(s, d).length);
            const services = Object.keys(s.services || {}).filter((k) => s.services[k]);

            return `
                <article class="staff-card${s.active === false ? " inactive" : ""}">
                    <div class="staff-card-top">
                        <span class="person-avatar ${escapeHtml(s.type)}">${avatarInner(staffPhotos[s.id], s.name)}</span>
                        <div>
                            <h4>${escapeHtml(staffDisplayName(s))}</h4>
                            <span class="type-chip staff-${escapeHtml(s.type)}">${escapeHtml(staffTypeLabel(s.type))}</span>
                            ${s.active === false ? '<span class="type-chip off">Inactive</span>' : ""}
                        </div>
                    </div>

                    <p class="staff-line"><a href="mailto:${escapeHtml(s.email)}">${escapeHtml(s.email || "")}</a>${s.phone ? ` · ${escapeHtml(s.phone)}` : ""}</p>
                    ${s.specialty ? `<p class="staff-line">${escapeHtml(s.specialty)}</p>` : ""}
                    <p class="staff-line">${services.map((k) => escapeHtml(SERVICES[k]?.name || k)).join(" · ") || "No services"}</p>
                    <p class="staff-line muted">${days.length ? `Works ${escapeHtml(describeDays(days))}` : "No weekly hours set"}</p>

                    <div class="staff-load">
                        <span><strong>${load.pending}</strong> pending</span>
                        <span><strong>${load.approved}</strong> upcoming</span>
                        <span><strong>${load.completed}</strong> completed</span>
                    </div>

                    <div class="appt-actions">
                        <button type="button" class="link-btn" data-edit-staff="${escapeHtml(s.id)}">Edit</button>
                        <button type="button" class="link-btn" data-reset-staff="${escapeHtml(s.id)}">Send password email</button>
                        <button type="button" class="link-btn ${s.active === false ? "success" : "danger"}" data-toggle-staff="${escapeHtml(s.id)}">${s.active === false ? "Reactivate" : "Deactivate"}</button>
                    </div>
                </article>`;
        }).join("")}</div>`;
    }

    function renderServiceChecks(selected) {
        $("staffServices").innerHTML = Object.entries(SERVICES).map(([id, svc]) => `
            <label class="check-row">
                <input type="checkbox" value="${id}" ${selected[id] ? "checked" : ""}>
                <span>${escapeHtml(svc.name)}</span>
            </label>`).join("");
    }

    function openStaffModal(id = null) {

        editingStaffId = id;
        const s = id ? staff[id] : null;

        $("staffModalTitle").textContent = s ? "Edit staff member" : "Add a doctor, nurse or dentist";
        $("staffSave").textContent = s ? "Save changes" : "Create account";
        $("staffNameInput").value = s?.name || "";
        $("staffEmailInput").value = s?.email || "";
        $("staffEmailInput").readOnly = Boolean(s);
        $("staffTypeInput").value = s?.type || "doctor";
        $("staffCreateNote").hidden = Boolean(s);
        $("staffError").textContent = "";

        const defaults = Object.fromEntries(STAFF_TYPES[$("staffTypeInput").value].services.map((k) => [k, true]));
        renderServiceChecks(s?.services || defaults);

        $("staffModal").classList.add("show");
        $("staffNameInput").focus();
    }

    function closeStaffModal() {
        $("staffModal").classList.remove("show");
        editingStaffId = null;
    }

    // New staff: pick the usual services for the chosen type
    $("staffTypeInput").addEventListener("change", () => {
        if (editingStaffId) return;
        renderServiceChecks(Object.fromEntries(STAFF_TYPES[$("staffTypeInput").value].services.map((k) => [k, true])));
    });

    $("staffModalClose").addEventListener("click", closeStaffModal);
    $("staffCancel").addEventListener("click", closeStaffModal);
    $("staffModal").addEventListener("click", (event) => {
        if (event.target === $("staffModal")) closeStaffModal();
    });

    $("addStaffBtn").addEventListener("click", () => openStaffModal());

    function randomPassword() {
        const bytes = crypto.getRandomValues(new Uint8Array(24));
        return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 32) + "A!9";
    }

    async function createStaffLogin(email) {

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

        const name = $("staffNameInput").value.trim().replace(/^Dr\.?\s+/i, "");
        const email = $("staffEmailInput").value.trim().toLowerCase();
        const type = $("staffTypeInput").value;
        const services = Object.fromEntries(
            [...$("staffServices").querySelectorAll("input:checked")].map((i) => [i.value, true]));

        $("staffError").textContent = "";

        if (!name) { $("staffError").textContent = "Enter the staff member's name."; return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $("staffError").textContent = "Enter a valid email address."; return; }
        if (Object.keys(services).length === 0) { $("staffError").textContent = "Choose at least one service."; return; }

        $("staffSave").disabled = true;

        try {

            if (editingStaffId) {

                await update(ref(db, `staff/${editingStaffId}`), { name, type, services });
                toast("Staff details saved.", "success");

            } else {

                const uid = await createStaffLogin(email);

                await set(ref(db, `staff/${uid}`), {
                    name,
                    email,
                    type,
                    services,
                    availability: DEFAULT_AVAILABILITY[type],
                    active: true,
                    createdAt: serverTimestamp(),
                    createdBy: adminUser.uid
                });

                await sendPasswordResetEmail(auth, email);

                toast(`${staffDisplayName({ name, type })} was added. They'll get an email to set their password.`, "success");
            }

            closeStaffModal();

        } catch (error) {

            console.error("Staff save error:", error);

            $("staffError").textContent =
                error.code === "auth/email-already-in-use" ? "An account already uses this email. Use the person's work email that isn't registered yet."
                : error.code === "auth/invalid-email" ? "That email address isn't valid."
                : error.code === "auth/operation-not-allowed" ? "Email/password sign-in is turned off in Firebase Authentication."
                : "Couldn't save. Check your connection and the database rules.";

        } finally {
            $("staffSave").disabled = false;
        }
    });

    $("staffList").addEventListener("click", async (event) => {

        if (event.target.closest("[data-add-staff]")) {
            openStaffModal();
            return;
        }

        const edit = event.target.closest("[data-edit-staff]");
        const reset = event.target.closest("[data-reset-staff]");
        const toggle = event.target.closest("[data-toggle-staff]");

        if (edit) {
            openStaffModal(edit.dataset.editStaff);
            return;
        }

        if (reset) {
            const s = staff[reset.dataset.resetStaff];
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
            const id = toggle.dataset.toggleStaff;
            const s = staff[id];
            const deactivate = s.active !== false;

            const upcoming = all.filter((a) => a.staffId === id && ["pending", "approved"].includes(statusOf(a)) && whenOf(a) > new Date()).length;

            if (deactivate && !confirm(
                `Deactivate ${staffDisplayName(s)}? They won't be able to log in to the staff dashboard or receive new bookings.` +
                (upcoming ? `\n\nThey still have ${upcoming} upcoming appointment${upcoming === 1 ? "" : "s"}. Cancel or reassign those first.` : ""))) return;

            try {
                await update(ref(db, `staff/${id}`), { active: !deactivate });
                toast(deactivate ? "Staff member deactivated." : "Staff member reactivated.", "success");
            } catch (error) {
                console.error("Toggle staff error:", error);
                toast("Couldn't update the staff member.", "error");
            }
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

        const isWeekly = currentViewMode === "weekly";
        const list = isWeekly
            ? filteredWeekAppointments(getWeekDays(currentWeekMonday))
            : sortList(filtered());

        if (list.length === 0) {
            toast(isWeekly
                ? "There are no appointments to export for this week."
                : "There is nothing to export for the current filters.", "error");
            return;
        }

        const header = ["Date", "Day", "Time", "Service", "Provider", "Patient", "Type", "ID", "Program / Department", "Email", "Phone", "Status", "Attendance", "Reason", "Instructions", "Note"];

        const rows = list.map((a) => {
            const dayObj = a.date ? parseDateKey(a.date) : null;
            const dayName = dayObj ? dayObj.toLocaleDateString("en-US", { weekday: "long" }) : "";
            return [
                a.date || "",
                dayName,
                a.time ? formatTime(a.time) : "",
                serviceName(a),
                providerName(a),
                patientName(a),
                patientRole(a),
                patientId(a),
                patientDetail(a),
                patientEmail(a),
                patientPhone(a),
                stateLabel(a),
                a.attendance === "confirmed" ? "Confirmed" : (statusOf(a) === "approved" ? "Not confirmed yet" : ""),
                a.reason || "",
                a.instructions || "",
                a.clinicNote || a.declineReason || ""
            ];
        });

        const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");

        // BOM so Excel reads accented names correctly
        const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);

        const filename = isWeekly
            ? `weekly-schedule-${toDateKey(currentWeekMonday)}.csv`
            : `appointments-${toDateKey(new Date())}.csv`;

        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
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

            let destination = "../student/st-appointment.html";

            try {
                const [employeeSnap, staffSnap] = await Promise.all([
                    get(ref(db, `employees/${user.uid}`)),
                    get(ref(db, `staff/${user.uid}`)).catch(() => null)
                ]);

                if (staffSnap?.exists()) destination = "../staff/staff.html";
                else if (employeeSnap.exists()) destination = "../employee/em-appointment.html";
            } catch (error) {
                console.warn("Could not check account type:", error);
            }

            window.location.replace(destination);
            return;
        }

        adminUser = user;
        adminName = user.displayName || user.email || "Admin";

        mountBell(user.uid, [$("bellSlotDesktop"), $("bellSlotMobile")]);

        $("accessCheck").hidden = true;
        $("adminContent").hidden = false;

        try {
            await loadProfiles();
        } catch (error) {
            console.error("Failed to load profiles:", error);
        }

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
