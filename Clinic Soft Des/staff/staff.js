// ==========================================
// CLINIC STAFF DASHBOARD (doctors, nurses, dentists)
// Review requests, approve with instructions, follow attendance live,
// check patient history and manage your own hours.
// ==========================================
import { auth, db } from "../firebase/firebase.js";

import {
    onAuthStateChanged,
    signOut,
    sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

import {
    ref,
    get,
    set,
    update,
    query,
    orderByChild,
    equalTo,
    onValue
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

import { ADMIN_UID, SWEEP_MS } from "../shared/config.js";

import {
    SERVICES,
    DAY_NAMES_LONG,
    toDateKey,
    toMinutes,
    formatTime,
    formatRange,
    formatDateLong,
    formatDateShort,
    formatMoment,
    escapeHtml,
    staffDisplayName,
    staffTypeLabel,
    staffWorksAt,
    rangesFor,
    describePref,
    statusOf,
    startOf,
    stateOf,
    stateLabel,
    STATE_INFO,
    isActive,
    reminderTimes,
    medicalHistoryHtml,
    hasMedicalHistory,
    historyTimelineHtml
} from "../shared/clinic.js";

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
    approveAppointment,
    declineAppointment,
    cancelAppointment,
    completeAppointment,
    markMissed,
    updateInstructions,
    saveVisitNotes,
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

    const serviceName = (a) => SERVICES[a.service]?.name || a.serviceName || "Appointment";
    const roleOf = (a) => (a.patientRole === "employee" ? "employee" : "student");
    const todayKey = () => toDateKey(new Date());

    function relativeStart(a) {

        const minutes = Math.round((startOf(a) - Date.now()) / 60000);

        if (minutes < 0) return "started";
        if (minutes < 60) return `in ${minutes} min`;

        const hours = Math.round(minutes / 60);
        if (hours < 24) return `in ${hours} hr${hours === 1 ? "" : "s"}`;

        const days = Math.round(hours / 24);
        return days === 1 ? "tomorrow" : `in ${days} days`;
    }

    function dayLabel(key) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);

        if (key === todayKey()) return `Today · ${formatDateLong(key)}`;
        if (key === toDateKey(tomorrow)) return `Tomorrow · ${formatDateLong(key)}`;
        return formatDateLong(key);
    }

    const msToText = (ms) => (ms ? formatMoment(new Date(ms)) : "");

    function greetingWord() {
        const hour = new Date().getHours();
        return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    }


    /* =========================================
       STATE
    ========================================= */

    let me = null;              // Firebase user
    let myPhoto = null;         // avatars/{uid}/photo
    let profile = {};           // staff/{uid}
    let mine = [];              // appointments assigned to me
    let loaded = false;
    let clinicWide = null;      // every appointment, loaded for the history search

    let activeTab = "requests";
    let scheduleRange = "upcoming";
    let highlightId = null;
    let openedFromLink = false;

    let modalAppt = null;
    let instructionsOnly = false;
    let busy = false;

    const actor = () => ({ uid: me.uid, name: staffDisplayName(profile), role: "staff" });
    const findAppt = (id) => mine.find((a) => a.id === id) || (clinicWide || []).find((a) => a.id === id);


    /* =========================================
       TABS
    ========================================= */

    function showTab(name) {

        activeTab = name;

        document.querySelectorAll(".staff-tabs .tab").forEach((tab) => {
            const on = tab.dataset.tab === name;
            tab.classList.toggle("active", on);
            tab.setAttribute("aria-selected", String(on));
        });

        document.querySelectorAll(".tab-panel").forEach((panel) => {
            panel.hidden = panel.id !== `panel-${name}`;
        });

        if (name === "history") renderHistory();
    }

    document.querySelector(".staff-tabs").addEventListener("click", (event) => {
        const tab = event.target.closest("[data-tab]");
        if (tab) showTab(tab.dataset.tab);
    });

    // "My Profile" lives in the tab row, but every other role reaches
    // their profile from the header, so the header link opens that tab.
    ["deskProfileBtn", "profileBtn"].forEach((id) => {
        const link = document.getElementById(id);
        if (!link) return;

        link.addEventListener("click", (event) => {
            event.preventDefault();
            showTab("profile");
            document.querySelector(".staff-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    });

    document.querySelectorAll("[data-go]").forEach((card) => {
        card.addEventListener("click", () => showTab(card.dataset.go));
    });


    /* =========================================
       STATS
    ========================================= */

    function renderStats() {

        const today = todayKey();
        const upcoming = mine.filter((a) => a.date >= today);

        const requests = mine.filter((a) => stateOf(a) === "pending");

        $("statRequests").textContent = requests.length;
        $("statToday").textContent = mine.filter((a) => a.date === today && ["approved", "awaiting", "attending", "completed"].includes(stateOf(a))).length;
        $("statAwaiting").textContent = upcoming.filter((a) => stateOf(a) === "awaiting").length;
        $("statAttending").textContent = upcoming.filter((a) => stateOf(a) === "attending" && startOf(a) > new Date()).length;

        $("requestCount").textContent = requests.length;
        $("requestCount").hidden = requests.length === 0;
    }


    /* =========================================
       REQUESTS
    ========================================= */

    function patientMeta(a, extra = "") {
        return `
            <div class="appt-meta">
                <span class="type-chip ${roleOf(a)}">${roleOf(a)}</span>
                ${a.patientId ? `<span>${escapeHtml(a.patientId)}</span>` : ""}
                <span>${escapeHtml(serviceName(a))}</span>
                ${extra}
            </div>`;
    }

    function patientButton(a) {
        return `<button type="button" class="name-btn" data-patient="${escapeHtml(a.id)}" title="Open patient record">${escapeHtml(a.patientName || "Patient")}</button>`;
    }

    function requestCard(a) {

        const urgent = startOf(a) - Date.now() < 24 * 36e5;
        const askedForMe = a.providerPref === "person";

        return `
            <article class="appt-card request${a.id === highlightId ? " highlight" : ""}" id="appt-${escapeHtml(a.id)}">
                <div class="appt-time">
                    ${formatTime(a.time)}
                    <small>${escapeHtml(formatDateShort(a.date))}</small>
                </div>

                <div class="appt-info">
                    <h4>${patientButton(a)}</h4>

                    ${patientMeta(a, `
                        <span class="pref-chip${askedForMe ? " mine" : ""}">${askedForMe ? "Asked for you" : escapeHtml(describePref(a))}</span>
                        <span class="when-chip${urgent ? " urgent" : ""}">${relativeStart(a)}</span>`)}

                    ${a.passedBy ? `<p class="appt-note">Passed on by ${escapeHtml(a.handledByName || "another provider")}${a.passNote ? `: “${escapeHtml(a.passNote)}”` : ""}</p>` : ""}

                    ${a.reason ? `<p class="appt-reason"><strong>Reason:</strong> ${escapeHtml(a.reason)}</p>` : '<p class="appt-reason">No reason given.</p>'}

                    ${hasMedicalHistory(a.medicalHistory)
                        ? `<details class="appt-history"><summary>Medical history provided</summary>${medicalHistoryHtml(a.medicalHistory)}</details>`
                        : '<p class="appt-note">No medical history provided.</p>'}
                </div>

                <div class="appt-side">
                    <div class="appt-actions">
                        <button type="button" class="link-btn success" data-action="approve" data-id="${escapeHtml(a.id)}">Approve</button>
                        <button type="button" class="link-btn danger" data-action="decline" data-id="${escapeHtml(a.id)}">Decline</button>
                    </div>
                </div>
            </article>
        `;
    }

    function renderRequests() {

        const list = mine
            .filter((a) => stateOf(a) === "pending")
            .sort((a, b) => startOf(a) - startOf(b));

        if (list.length === 0) {
            $("requestList").innerHTML = `
                <div class="empty-state">
                    <h4>You're all caught up</h4>
                    <p>New appointment requests assigned to you will appear here instantly.</p>
                </div>`;
            return;
        }

        $("requestList").innerHTML = `<div class="appointment-list">${list.map(requestCard).join("")}</div>`;
    }


    /* =========================================
       SCHEDULE (live attendance)
    ========================================= */

    function attendanceInfo(a, state) {

        const t = reminderTimes(a);
        const sent = a.reminders || {};

        switch (state) {
            case "approved":
                return { label: "Not asked yet", cls: "approved", detail: `Confirmation request goes out ${formatMoment(t.first)}` };
            case "awaiting":
                return {
                    label: "Asked, no reply yet",
                    cls: "awaiting",
                    detail: `${sent.lastCall ? "Last call sent" : sent.first ? `Asked ${msToText(sent.first)}` : "Reminder going out now"} · auto-cancels ${formatMoment(t.deadline)} if no reply`
                };
            case "attending":
                return { label: "Confirmed coming", cls: "attending", detail: a.attendanceAt ? `Confirmed ${msToText(a.attendanceAt)}` : "" };
            case "lapsed":
                return { label: "No reply: cancelling", cls: "cancelled", detail: "The time will open for other patients" };
            case "cancelled":
                return {
                    label: a.cancelledBy === "patient" ? "Cancelled by patient"
                        : a.cancelReason === "no-confirmation" ? "Auto-cancelled: no reply"
                        : a.cancelReason === "expired" ? "Expired: not approved"
                        : "Cancelled by clinic",
                    cls: "cancelled",
                    detail: a.cancelledAt ? `${msToText(a.cancelledAt)}` : ""
                };
            default:
                return { label: stateLabel(a, state), cls: STATE_INFO[state]?.cls || "pending", detail: "" };
        }
    }

    function scheduleActions(a, state) {

        if (!["approved", "awaiting", "attending", "lapsed"].includes(state)) return "";

        const started = startOf(a) <= new Date();
        const id = escapeHtml(a.id);
        const buttons = [];

        if (a.date <= todayKey()) buttons.push(`<button type="button" class="link-btn success" data-action="complete" data-id="${id}">Completed</button>`);
        if (started) buttons.push(`<button type="button" class="link-btn" data-action="missed" data-id="${id}">No-show</button>`);
        if (!started) {
            buttons.push(`<button type="button" class="link-btn" data-action="instructions" data-id="${id}">${a.instructions ? "Edit instructions" : "Add instructions"}</button>`);
            buttons.push(`<button type="button" class="link-btn danger" data-action="cancel" data-id="${id}">Cancel</button>`);
        }

        return `<div class="appt-actions">${buttons.join("")}</div>`;
    }

    function scheduleCard(a) {

        const state = stateOf(a);
        const info = attendanceInfo(a, state);
        const inactive = ["cancelled", "declined", "lapsed", "expired"].includes(state);

        return `
            <article class="appt-card sched ${info.cls}${inactive ? " inactive" : ""}${a.id === highlightId ? " highlight" : ""}" id="appt-${escapeHtml(a.id)}">
                <div class="appt-time">
                    ${formatTime(a.time)}
                    <small>${relativeStart(a)}</small>
                </div>

                <div class="appt-info">
                    <h4>${patientButton(a)}</h4>
                    ${patientMeta(a)}
                    ${a.reason ? `<p class="appt-reason"><strong>Reason:</strong> ${escapeHtml(a.reason)}</p>` : ""}
                    ${a.instructions && !inactive ? `<div class="instructions-box"><span>Instructions sent</span><p>${escapeHtml(a.instructions)}</p></div>` : ""}
                    ${hasMedicalHistory(a.medicalHistory) ? `<details class="appt-history"><summary>Medical history provided</summary>${medicalHistoryHtml(a.medicalHistory)}</details>` : ""}
                </div>

                <div class="appt-side">
                    <span class="attend-status ${info.cls}">${escapeHtml(info.label)}</span>
                    ${info.detail ? `<small class="attend-detail">${escapeHtml(info.detail)}</small>` : ""}
                    ${scheduleActions(a, state)}
                </div>
            </article>
        `;
    }

    function renderSchedule() {

        const today = todayKey();
        const weekEnd = new Date();
        weekEnd.setDate(weekEnd.getDate() + 6);
        const lastKey = toDateKey(weekEnd);

        const showCancelled = $("showCancelled").checked;

        const inRange = (a) =>
            scheduleRange === "today" ? a.date === today
            : scheduleRange === "week" ? a.date >= today && a.date <= lastKey
            : a.date >= today;

        // Visits from earlier days nobody closed yet
        const wrapUp = mine
            .filter((a) => a.date < today && ["approved", "awaiting", "attending", "lapsed"].includes(stateOf(a)))
            .sort((a, b) => startOf(a) - startOf(b));

        const items = mine.filter((a) => {
            if (!a.date || !inRange(a)) return false;
            const state = stateOf(a);
            if (["approved", "awaiting", "attending", "lapsed"].includes(state)) return true;
            if (["completed", "missed"].includes(state)) return a.date === today;
            // Cancellations of visits that were on the schedule
            return showCancelled && state === "cancelled" && Boolean(a.approvedAt);
        }).sort((a, b) => startOf(a) - startOf(b));

        let html = "";

        if (wrapUp.length) {
            html += `
                <section class="day-group wrap-up">
                    <div class="day-heading">
                        <h3>Needs wrap-up</h3>
                        <span>Mark these past visits as completed or no-show</span>
                    </div>
                    <div class="appointment-list">${wrapUp.map(scheduleCard).join("")}</div>
                </section>`;
        }

        if (items.length === 0) {
            html += `
                <div class="empty-state">
                    <h4>No approved visits ${scheduleRange === "today" ? "today" : "coming up"}</h4>
                    <p>Approve requests from the Requests tab and they'll show up here with their live attendance status.</p>
                </div>`;
            $("scheduleList").innerHTML = html;
            return;
        }

        const groups = new Map();
        items.forEach((a) => {
            if (!groups.has(a.date)) groups.set(a.date, []);
            groups.get(a.date).push(a);
        });

        html += [...groups.entries()].map(([key, list]) => {
            const active = list.filter((a) => !["cancelled", "declined", "lapsed"].includes(stateOf(a)));
            const coming = active.filter((a) => stateOf(a) === "attending").length;

            return `
                <section class="day-group">
                    <div class="day-heading">
                        <h3>${escapeHtml(dayLabel(key))}</h3>
                        <span>${active.length} visit${active.length === 1 ? "" : "s"} · ${coming} confirmed</span>
                    </div>
                    <div class="appointment-list">${list.map(scheduleCard).join("")}</div>
                </section>`;
        }).join("");

        $("scheduleList").innerHTML = html;
    }

    $("scheduleFilters").addEventListener("click", (event) => {
        const button = event.target.closest(".filter");
        if (!button) return;

        scheduleRange = button.dataset.range;
        $("scheduleFilters").querySelectorAll(".filter").forEach((b) => b.classList.toggle("active", b === button));
        renderSchedule();
    });

    $("showCancelled").addEventListener("change", renderSchedule);


    /* =========================================
       PATIENT HISTORY
    ========================================= */

    function historyRow(a) {

        const state = stateOf(a);
        const mineToo = a.staffId === me.uid;

        return `
            <article class="history-row" id="appt-${escapeHtml(a.id)}">
                <div class="history-when">
                    <strong>${a.date ? escapeHtml(formatDateShort(a.date)) : "--"}</strong>
                    <small>${a.time ? formatTime(a.time) : ""}</small>
                </div>
                <div class="history-main">
                    ${patientButton(a)}
                    ${patientMeta(a, mineToo ? "" : `<span>with ${escapeHtml(a.staffName || "another provider")}</span>`)}
                    ${a.reason ? `<p class="appt-reason">${escapeHtml(a.reason)}</p>` : ""}
                </div>
                <span class="badge ${STATE_INFO[state]?.cls || "pending"}">${escapeHtml(stateLabel(a, state))}</span>
            </article>`;
    }

    function renderHistory() {

        if (!loaded) return;

        const source = clinicWide || mine;
        const status = $("historyStatus").value;
        const term = $("historySearch").value.trim().toLowerCase();
        const now = new Date();

        const list = source.filter((a) => {
            const state = stateOf(a);
            const past = ["completed", "missed", "cancelled", "declined", "expired", "lapsed"].includes(state) || startOf(a) < now;
            if (!past) return false;

            if (status !== "all") {
                const bucket = state === "expired" || state === "lapsed" ? "cancelled" : state;
                if (bucket !== status) return false;
            }

            if (term) {
                const haystack = `${a.patientName} ${a.patientId} ${serviceName(a)} ${a.staffName}`.toLowerCase();
                if (!haystack.includes(term)) return false;
            }

            return true;
        }).sort((a, b) => startOf(b) - startOf(a));

        $("historyCount").textContent = `${list.length} past appointment${list.length === 1 ? "" : "s"}${clinicWide ? " across the clinic" : " with you"} · open a name to see the full patient record`;

        $("historyList").innerHTML = list.length
            ? `<div class="history-table">${list.slice(0, 200).map(historyRow).join("")}</div>`
            : `<div class="empty-state"><h4>No past appointments found</h4><p>Completed, missed and cancelled visits are kept here.</p></div>`;
    }

    $("historySearch").addEventListener("input", renderHistory);
    $("historyStatus").addEventListener("change", renderHistory);

    // "Whose patients" switch, added next to the filters
    const scopeGroup = document.createElement("div");
    scopeGroup.className = "form-group";
    scopeGroup.innerHTML = `
        <label for="historyScope">Patients</label>
        <select id="historyScope">
            <option value="mine">Seen by me</option>
            <option value="clinic">Whole clinic</option>
        </select>`;
    document.querySelector(".history-fields-bar").appendChild(scopeGroup);

    $("historyScope").addEventListener("change", async (event) => {

        if (event.target.value === "mine") {
            clinicWide = null;
            renderHistory();
            return;
        }

        $("historyCount").textContent = "Loading the clinic's records...";

        try {
            const snap = await get(ref(db, "appointments"));
            clinicWide = Object.entries(snap.val() || {}).map(([id, value]) => ({ id, ...value }));
        } catch (error) {
            console.error("Clinic history error:", error);
            toast("Couldn't load the clinic's records.", "error");
            event.target.value = "mine";
            clinicWide = null;
        }

        renderHistory();
    });


    /* =========================================
       PATIENT RECORD
    ========================================= */

    let patientVisits = {};

    async function openPatient(a) {

        openModal("patientModal");

        $("patientTitle").textContent = a.patientName || "Patient";
        $("patientBody").innerHTML = '<p class="modal-text">Loading the patient record...</p>';

        try {

            const folder = roleOf(a) === "employee" ? "employees" : "students";

            const [profileSnap, historySnap, visitsSnap, patientPhoto] = await Promise.all([
                get(ref(db, `${folder}/${a.uid}`)),
                get(ref(db, `medicalHistory/${a.uid}`)),
                get(query(ref(db, "appointments"), orderByChild("uid"), equalTo(a.uid))),
                loadAvatar(a.uid)
            ]);

            const p = profileSnap.val() || {};
            const saved = historySnap.val();

            const visits = Object.entries(visitsSnap.val() || {})
                .map(([id, value]) => ({ id, ...value }))
                .sort((x, y) => startOf(y) - startOf(x));

            // Private visit notes for finished visits
            const notes = {};
            await Promise.all(visits
                .filter((v) => ["completed", "missed"].includes(statusOf(v)))
                .map(async (v) => {
                    const snap = await get(ref(db, `visitNotes/${v.id}`)).catch(() => null);
                    if (snap?.exists()) notes[v.id] = snap.val();
                }));

            const info = [
                ["Name", p.fullName || p.name || a.patientName],
                [roleOf(a) === "employee" ? "Employee ID" : "Student ID", p.studentId || p.employeeId || a.patientId],
                [roleOf(a) === "employee" ? "Department" : "Program", roleOf(a) === "employee" ? p.department : [p.program, p.yearLevel].filter(Boolean).join(" · ")],
                ["Email", p.email || a.patientEmail],
                ["Phone", p.phone || a.patientPhone],
                ["Emergency contact", [p.emergencyName, p.relationship, p.emergencyPhone].filter(Boolean).join(" · ")]
            ];

            const completed = visits.filter((v) => statusOf(v) === "completed").length;
            const missed = visits.filter((v) => statusOf(v) === "missed").length;
            const autoCancelled = visits.filter((v) => v.cancelReason === "no-confirmation").length;

            $("patientBody").innerHTML = `
                <div class="record-head">
                    <span class="person-avatar big">${avatarInner(patientPhoto, p.fullName || p.name || a.patientName)}</span>
                    <div>
                        <strong>${escapeHtml(p.fullName || p.name || a.patientName || "Patient")}</strong>
                        <span>${roleOf(a) === "employee" ? "Employee" : "Student"}</span>
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
                    <span><strong>${visits.length}</strong> appointments</span>
                    <span><strong>${completed}</strong> completed</span>
                    <span class="${missed ? "warn" : ""}"><strong>${missed}</strong> no-shows</span>
                    <span class="${autoCancelled ? "warn" : ""}"><strong>${autoCancelled}</strong> unconfirmed</span>
                </div>

                <h4 class="record-heading">Medical history on file</h4>
                ${medicalHistoryHtml(saved)}
                ${saved?.updatedAt ? `<p class="record-sub">Last updated ${escapeHtml(msToText(saved.updatedAt))}</p>` : ""}

                <h4 class="record-heading">Visit history</h4>
                <div class="visit-list">
                    ${visits.length === 0 ? '<p class="muted-text">No visits yet.</p>' : visits.map((v) => {
                        const state = stateOf(v);
                        const note = notes[v.id];
                        const finished = ["completed", "missed"].includes(statusOf(v));

                        return `
                            <div class="visit${v.id === a.id ? " current" : ""}">
                                <div class="visit-top">
                                    <strong>${v.date ? escapeHtml(formatDateShort(v.date)) : "--"} · ${v.time ? formatTime(v.time) : ""}</strong>
                                    <span class="badge ${STATE_INFO[state]?.cls || "pending"}">${escapeHtml(stateLabel(v, state))}</span>
                                </div>
                                <p>${escapeHtml(serviceName(v))} · ${escapeHtml(v.staffName || "Unassigned")}</p>
                                ${v.reason ? `<p class="visit-reason">Reason: ${escapeHtml(v.reason)}</p>` : ""}
                                ${v.instructions ? `<p class="visit-reason">Instructions: ${escapeHtml(v.instructions)}</p>` : ""}
                                ${v.history ? `<details class="visit-notes"><summary>Timeline</summary>${historyTimelineHtml(v)}</details>` : ""}
                                ${finished ? `
                                    <details class="visit-notes"${note ? " open" : ""}>
                                        <summary>${note ? `Visit notes · ${escapeHtml(note.byName || "")}` : "Add visit notes"}</summary>
                                        <textarea maxlength="1500" data-notes-for="${escapeHtml(v.id)}" placeholder="Findings, treatment, medicines, follow-up...">${escapeHtml(note?.text || "")}</textarea>
                                        <button type="button" class="link-btn primary" data-save-notes="${escapeHtml(v.id)}">Save notes</button>
                                    </details>` : ""}
                            </div>`;
                    }).join("")}
                </div>
            `;

            // Saving notes needs the visit itself, which may belong to another provider
            patientVisits = Object.fromEntries(visits.map((v) => [v.id, v]));

        } catch (error) {
            console.error("Patient record error:", error);
            $("patientBody").innerHTML = '<p class="modal-text">Couldn\'t load this patient record. Check your connection and the database rules.</p>';
        }
    }

    $("patientBody").addEventListener("click", async (event) => {

        const button = event.target.closest("[data-save-notes]");
        if (!button) return;

        const visit = patientVisits[button.dataset.saveNotes];
        const box = $("patientBody").querySelector(`[data-notes-for="${CSS.escape(button.dataset.saveNotes)}"]`);
        if (!visit || !box) return;

        button.disabled = true;

        try {
            await saveVisitNotes(visit, actor(), box.value);
            toast("Visit notes saved.", "success");
        } catch (error) {
            console.error("Notes error:", error);
            toast("Couldn't save the notes.", "error");
        } finally {
            button.disabled = false;
        }
    });


    /* =========================================
       ACTION BUTTONS
    ========================================= */

    const INSTRUCTION_CHIPS = {
        common: [
            "Please arrive 10 minutes early and bring your ID.",
            "Bring any previous lab results, X-rays or prescriptions.",
            "Write down the medicines you're currently taking."
        ],
        consultation: [
            "Please fast for 8 hours before your visit (water is okay).",
            "Wear loose, comfortable clothing.",
            "Don't take pain relievers 4 hours before so we can check your symptoms."
        ],
        dental: [
            "Brush and floss before your visit.",
            "Avoid eating for 1 hour before your appointment."
        ],
        certificate: [
            "Bring the certificate request form from your department.",
            "Bring your vaccination card."
        ]
    };

    function openApprove(a, onlyInstructions) {

        modalAppt = a;
        instructionsOnly = onlyInstructions;

        $("approveLabel").textContent = onlyInstructions ? "PRE-APPOINTMENT INSTRUCTIONS" : "APPROVE REQUEST";
        $("approveTitle").textContent = onlyInstructions ? "Instructions for the patient" : "Approve this appointment?";
        $("approveConfirm").textContent = onlyInstructions ? "Save and notify patient" : "Approve and notify patient";

        $("approveDetail").innerHTML =
            `<strong>${escapeHtml(a.patientName)}</strong> · ${escapeHtml(serviceName(a))}<br>` +
            `${escapeHtml(formatDateLong(a.date))}, ${escapeHtml(formatRange(a.time))}` +
            (staffWorksAt(profile, a.date, a.time) ? "" :
                '<span class="warn">This time is outside your saved hours or on a day off. Approve only if you can make it.</span>');

        const chips = [...(INSTRUCTION_CHIPS[a.service] || []), ...INSTRUCTION_CHIPS.common];
        $("instructionChips").innerHTML = chips.map((text) =>
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

    $("approveConfirm").addEventListener("click", async () => {

        const a = modalAppt;
        if (!a || busy) return;

        busy = true;
        $("approveConfirm").disabled = true;

        try {
            if (instructionsOnly) {
                await updateInstructions(a, actor(), $("instructionsInput").value);
                toast("Instructions saved and sent to the patient.", "success");
            } else {
                await approveAppointment(a, actor(), { instructions: $("instructionsInput").value });
                toast(`Approved. ${a.patientName} has been notified.`, "success");
            }
            closeModals();
        } catch (error) {
            console.error("Approve error:", error);
            toast("That change couldn't be saved. Please try again.", "error");
        } finally {
            busy = false;
            $("approveConfirm").disabled = false;
        }
    });

    function openDecline(a) {

        modalAppt = a;

        const askedForMe = a.providerPref === "person";

        $("declineDetail").innerHTML =
            `<strong>${escapeHtml(a.patientName)}</strong> · ${escapeHtml(serviceName(a))}<br>` +
            `${escapeHtml(formatDateLong(a.date))}, ${escapeHtml(formatRange(a.time))}`;

        $("passRow").hidden = askedForMe;
        $("passOnInput").checked = !askedForMe;
        $("passNote").hidden = !askedForMe;
        $("passNote").textContent = "The patient asked for you specifically, so the request will be declined and they'll be told to book again.";
        $("declineReason").value = "";

        openModal("declineModal");
    }

    $("declineConfirm").addEventListener("click", async () => {

        const a = modalAppt;
        if (!a || busy) return;

        busy = true;
        $("declineConfirm").disabled = true;

        try {
            const result = await declineAppointment(a, actor(), {
                reason: $("declineReason").value,
                passOn: $("passOnInput").checked
            });

            toast(result.passedTo
                ? `Passed to ${result.passedTo}. The patient was told.`
                : "Request declined. The patient was notified.", "success");

            closeModals();
        } catch (error) {
            console.error("Decline error:", error);
            toast("That change couldn't be saved. Please try again.", "error");
        } finally {
            busy = false;
            $("declineConfirm").disabled = false;
        }
    });

    function openComplete(a) {
        modalAppt = a;
        $("completeDetail").innerHTML =
            `<strong>${escapeHtml(a.patientName)}</strong> · ${escapeHtml(serviceName(a))} · ${escapeHtml(formatDateShort(a.date))}, ${formatTime(a.time)}`;
        $("visitNotesInput").value = "";
        openModal("completeModal");
        $("visitNotesInput").focus();
    }

    $("completeConfirm").addEventListener("click", async () => {

        const a = modalAppt;
        if (!a || busy) return;

        busy = true;
        $("completeConfirm").disabled = true;

        try {
            await completeAppointment(a, actor(), { notes: $("visitNotesInput").value });
            toast("Marked as completed.", "success");
            closeModals();
        } catch (error) {
            console.error("Complete error:", error);
            toast("That change couldn't be saved. Please try again.", "error");
        } finally {
            busy = false;
            $("completeConfirm").disabled = false;
        }
    });

    function openCancel(a) {
        modalAppt = a;
        $("cancelDetail").innerHTML =
            `<strong>${escapeHtml(a.patientName)}</strong><br>${escapeHtml(serviceName(a))} · ${escapeHtml(formatDateLong(a.date))} at ${formatTime(a.time)}`;
        $("cancelNote").value = "";
        openModal("cancelModal");
        $("cancelNote").focus();
    }

    $("cancelConfirm").addEventListener("click", async () => {

        const a = modalAppt;
        if (!a || busy) return;

        busy = true;
        $("cancelConfirm").disabled = true;

        try {
            await cancelAppointment(a, actor(), { note: $("cancelNote").value });
            toast("Appointment cancelled. The patient was notified.", "success");
            closeModals();
        } catch (error) {
            console.error("Cancel error:", error);
            toast("That change couldn't be saved. Please try again.", "error");
        } finally {
            busy = false;
            $("cancelConfirm").disabled = false;
        }
    });

    async function handleListClick(event) {

        const nameBtn = event.target.closest("[data-patient]");

        if (nameBtn) {
            const a = findAppt(nameBtn.dataset.patient);
            if (a) openPatient(a);
            return;
        }

        const button = event.target.closest("[data-action]");
        if (!button) return;

        const a = findAppt(button.dataset.id);
        if (!a) return;

        switch (button.dataset.action) {
            case "approve": openApprove(a, false); break;
            case "instructions": openApprove(a, true); break;
            case "decline": openDecline(a); break;
            case "complete": openComplete(a); break;
            case "cancel": openCancel(a); break;
            case "missed":
                if (!confirm(`Mark ${a.patientName} as a no-show?`)) return;
                button.disabled = true;
                try {
                    await markMissed(a, actor());
                    toast("Marked as a no-show.", "success");
                } catch (error) {
                    console.error("No-show error:", error);
                    toast("That change couldn't be saved.", "error");
                    button.disabled = false;
                }
                break;
        }
    }

    ["requestList", "scheduleList", "historyList"].forEach((id) => {
        $(id).addEventListener("click", handleListClick);
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
       MY AVAILABILITY
    ========================================= */

    const EDIT_DAYS = [1, 2, 3, 4, 5, 6, 0];

    function renderWeekEditor() {

        $("weekEditor").innerHTML = `
            <div class="week-row head">
                <span>Day</span><span>Start</span><span>End</span><span>Break from</span><span>Break to</span>
            </div>
            ${EDIT_DAYS.map((d) => {
                const ranges = rangesFor(profile, d);
                const on = ranges.length > 0;
                const start = on ? ranges[0][0] : "08:00";
                const end = on ? ranges[ranges.length - 1][1] : "17:00";
                const breakFrom = ranges.length > 1 ? ranges[0][1] : "";
                const breakTo = ranges.length > 1 ? ranges[1][0] : "";

                return `
                    <div class="week-row${on ? "" : " off"}" data-day="${d}">
                        <label class="check-row day-toggle">
                            <input type="checkbox" data-field="on" ${on ? "checked" : ""}>
                            <span>${DAY_NAMES_LONG[d]}</span>
                        </label>
                        <label class="time-field"><small>Start</small><input type="time" data-field="start" value="${start}" step="1800"></label>
                        <label class="time-field"><small>End</small><input type="time" data-field="end" value="${end}" step="1800"></label>
                        <label class="time-field"><small>Break from</small><input type="time" data-field="breakFrom" value="${breakFrom}" step="1800"></label>
                        <label class="time-field"><small>Break to</small><input type="time" data-field="breakTo" value="${breakTo}" step="1800"></label>
                    </div>`;
            }).join("")}
        `;
    }

    $("weekEditor").addEventListener("change", (event) => {
        const row = event.target.closest(".week-row");
        if (row && event.target.dataset.field === "on") row.classList.toggle("off", !event.target.checked);
        $("hoursState").textContent = "Unsaved changes";
    });

    function readWeekEditor() {

        const availability = {};

        for (const row of $("weekEditor").querySelectorAll(".week-row[data-day]")) {

            const field = (name) => row.querySelector(`[data-field="${name}"]`);
            const day = DAY_NAMES_LONG[row.dataset.day];

            if (!field("on").checked) continue;

            const start = field("start").value;
            const end = field("end").value;
            const breakFrom = field("breakFrom").value;
            const breakTo = field("breakTo").value;

            if (!start || !end || toMinutes(start) >= toMinutes(end)) {
                return { error: `${day}: the end time must be after the start time.` };
            }

            if (Boolean(breakFrom) !== Boolean(breakTo)) {
                return { error: `${day}: fill in both break times, or leave both empty.` };
            }

            if (breakFrom) {
                const ok = toMinutes(start) < toMinutes(breakFrom) &&
                    toMinutes(breakFrom) < toMinutes(breakTo) &&
                    toMinutes(breakTo) < toMinutes(end);

                if (!ok) return { error: `${day}: the break must be inside working hours.` };

                availability[row.dataset.day] = [[start, breakFrom], [breakTo, end]];
            } else {
                availability[row.dataset.day] = [[start, end]];
            }
        }

        return { availability };
    }

    $("saveHoursBtn").addEventListener("click", async () => {

        const { availability, error } = readWeekEditor();

        if (error) {
            toast(error, "error");
            return;
        }

        $("saveHoursBtn").disabled = true;

        try {
            await set(ref(db, `staff/${me.uid}/availability`), availability);

            $("hoursState").textContent = "Saved";

            // Booked visits are kept even if they now fall outside the hours
            const outside = mine.filter((a) => isActive(a) && startOf(a) > new Date() &&
                !staffWorksAt({ ...profile, availability }, a.date, a.time));

            toast(outside.length
                ? `Hours saved. ${outside.length} booked visit${outside.length === 1 ? " is" : "s are"} now outside your hours: they're kept, so cancel them if you can't make it.`
                : "Weekly hours saved. Patients see the new times right away.", outside.length ? "info" : "success");

        } catch (err) {
            console.error("Hours error:", err);
            toast("Couldn't save your hours. Please try again.", "error");
        } finally {
            $("saveHoursBtn").disabled = false;
        }
    });

    function renderDaysOff() {

        const today = todayKey();
        const entries = Object.entries(profile.daysOff || {})
            .filter(([date]) => date >= today)
            .sort(([a], [b]) => a.localeCompare(b));

        $("dayOffList").innerHTML = entries.length
            ? entries.map(([date, note]) => `
                <li>
                    <span><strong>${escapeHtml(formatDateLong(date))}</strong>${typeof note === "string" && note ? ` · ${escapeHtml(note)}` : ""}</span>
                    <button type="button" class="link-btn danger" data-remove-off="${escapeHtml(date)}">Remove</button>
                </li>`).join("")
            : '<li class="muted-text">No upcoming days off.</li>';

        $("myServices").innerHTML = Object.keys(profile.services || {})
            .filter((s) => profile.services[s])
            .map((s) => `<span class="service-chip">${escapeHtml(SERVICES[s]?.name || s)}</span>`)
            .join("") || '<span class="muted-text">None yet</span>';
    }

    $("dayOffDate").min = todayKey();

    $("addDayOffBtn").addEventListener("click", async () => {

        const date = $("dayOffDate").value;

        if (!date || date < todayKey()) {
            toast("Pick a date from today onward.", "error");
            return;
        }

        try {
            await set(ref(db, `staff/${me.uid}/daysOff/${date}`), $("dayOffNote").value.trim() || "Day off");

            const affected = mine.filter((a) => a.date === date && isActive(a));

            $("dayOffWarning").hidden = affected.length === 0;
            $("dayOffWarning").textContent = affected.length
                ? `You still have ${affected.length} appointment${affected.length === 1 ? "" : "s"} on ${formatDateLong(date)}. Decline or cancel ${affected.length === 1 ? "it" : "them"} from the Requests or Schedule tab so the patient${affected.length === 1 ? "" : "s"} can rebook.`
                : "";

            $("dayOffDate").value = "";
            $("dayOffNote").value = "";
            toast("Day off added.", "success");

        } catch (error) {
            console.error("Day off error:", error);
            toast("Couldn't add the day off.", "error");
        }
    });

    $("dayOffList").addEventListener("click", async (event) => {

        const button = event.target.closest("[data-remove-off]");
        if (!button) return;

        try {
            await set(ref(db, `staff/${me.uid}/daysOff/${button.dataset.removeOff}`), null);
            $("dayOffWarning").hidden = true;
        } catch (error) {
            console.error("Remove day off error:", error);
            toast("Couldn't remove the day off.", "error");
        }
    });


    /* =========================================
       MY PROFILE
       Staff may edit their own name, specialization, phone and bio
       (the database rules allow only these fields). Role, services
       and login email stay with the admin.
    ========================================= */

    const PHONE_PATTERN = /^[+()\-\s\d]{7,20}$/;

    function renderProfilePreview() {
        const name = $("profName").value.trim() || profile.name || "";
        const preview = { ...profile, name };
        const specialty = $("profSpecialty").value.trim();
        const bio = $("profBio").value.trim();

        $("profilePreview").innerHTML = `
            <span class="person-avatar big ${escapeHtml(profile.type)}">${avatarInner(myPhoto, name)}</span>
            <span class="person-text">
                <strong>${escapeHtml(staffDisplayName(preview))}</strong>
                <small>${escapeHtml(staffTypeLabel(profile.type))}${specialty ? ` · ${escapeHtml(specialty)}` : ""}</small>
                ${bio ? `<small class="preview-bio">${escapeHtml(bio)}</small>` : ""}
                <span class="photo-actions">
                    <button type="button" class="link-btn" data-photo="change">${myPhoto ? "Change photo" : "Add a photo"}</button>
                    ${myPhoto ? '<button type="button" class="link-btn danger" data-photo="remove">Remove</button>' : ""}
                </span>
            </span>`;

        $("profBioCount").textContent = `${$("profBio").value.length} / 200`;
    }

    // Filled once; later live updates don't overwrite what's being typed
    function fillProfileForm() {
        $("profName").value = profile.name || "";
        $("profSpecialty").value = profile.specialty || "";
        $("profPhone").value = profile.phone || "";
        $("profBio").value = profile.bio || "";
        $("profEmail").textContent = profile.email || me.email || "";
        $("profRole").textContent = staffTypeLabel(profile.type);
        renderProfilePreview();
    }

    ["profName", "profSpecialty", "profPhone", "profBio"].forEach((id) => {
        $(id).addEventListener("input", () => {
            $("profileState").textContent = "Unsaved changes";
            renderProfilePreview();
        });
    });

    // Photo is saved right away (separate from the Save profile button)
    $("profilePreview").addEventListener("click", async (event) => {

        const button = event.target.closest("[data-photo]");
        if (!button) return;

        let newPhoto = null;

        if (button.dataset.photo === "change") {
            const file = await pickImage();
            if (!file) return;

            try {
                newPhoto = await shrinkImage(file);
            } catch (error) {
                toast(photoErrorMessage(error), "error");
                return;
            }
        } else if (!confirm("Remove your profile photo?")) {
            return;
        }

        button.disabled = true;

        try {
            await saveAvatar(me.uid, newPhoto);
            myPhoto = newPhoto;
            renderProfilePreview();
            toast(newPhoto ? "Photo updated. Patients see it when choosing a provider." : "Photo removed.", "success");
        } catch (error) {
            console.error("Photo error:", error);
            toast(photoErrorMessage(error), "error");
            button.disabled = false;
        }
    });

    $("saveProfileBtn").addEventListener("click", async () => {

        const name = $("profName").value.trim().replace(/^Dr\.?\s+/i, "");
        const specialty = $("profSpecialty").value.trim();
        const phone = $("profPhone").value.trim();
        const bio = $("profBio").value.trim();

        if (name.length < 2) {
            toast("Please enter your full name.", "error");
            return;
        }

        if (phone && !PHONE_PATTERN.test(phone)) {
            toast("Please enter a valid contact number.", "error");
            return;
        }

        $("saveProfileBtn").disabled = true;

        try {
            const nameChanged = name !== profile.name;

            await update(ref(db, `staff/${me.uid}`), {
                name,
                specialty: specialty || null,
                phone: phone || null,
                bio: bio || null
            });

            // Keep the name on upcoming visits in step with the profile
            if (nameChanged) {
                const newName = staffDisplayName({ ...profile, name });
                const changes = {};

                mine.filter((a) => isActive(a) && startOf(a) > new Date())
                    .forEach((a) => { changes[`appointments/${a.id}/staffName`] = newName; });

                if (Object.keys(changes).length) await update(ref(db), changes);
            }

            $("profileState").textContent = "Saved";
            toast("Profile saved. Patients see the changes right away.", "success");

        } catch (error) {
            console.error("Profile save error:", error);
            toast("Couldn't save your profile. Check that the latest database rules are published.", "error");
        } finally {
            $("saveProfileBtn").disabled = false;
        }
    });

    $("passwordEmailBtn").addEventListener("click", async () => {

        const email = profile.email || me.email;
        if (!email) return;

        $("passwordEmailBtn").disabled = true;

        try {
            await sendPasswordResetEmail(auth, email);
            toast(`Password change link sent to ${email}. Check your inbox (and spam).`, "success");
        } catch (error) {
            console.error("Password email error:", error);
            toast("Couldn't send the email. Please try again later.", "error");
        } finally {
            $("passwordEmailBtn").disabled = false;
        }
    });


    /* =========================================
       RENDER + LIVE DATA
    ========================================= */

    function render() {
        if (!loaded) return;
        renderStats();
        renderRequests();
        renderSchedule();
        if (activeTab === "history") renderHistory();
    }

    // Email / notification links: staff.html?appt=ID
    function focusAppointment(id) {

        const a = mine.find((item) => item.id === id);
        if (!a) return;

        const state = stateOf(a);
        const tab = state === "pending" ? "requests"
            : (["approved", "awaiting", "attending", "lapsed"].includes(state) && a.date >= todayKey()) ? "schedule"
            : "history";

        if (tab === "schedule") {
            scheduleRange = "upcoming";
            $("showCancelled").checked = true;
        }

        highlightId = id;
        showTab(tab);
        render();

        document.getElementById(`appt-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });

        setTimeout(() => {
            highlightId = null;
            render();
        }, 6000);
    }

    window.addEventListener("bell:open", (event) => {
        if (event.detail?.apptId) focusAppointment(event.detail.apptId);
    });

    function watch() {

        onValue(ref(db, `staff/${me.uid}`), (snapshot) => {
            profile = snapshot.val() || profile;
            renderDaysOff();
            $("greeting").textContent = `${greetingWord()}, ${staffDisplayName(profile)}`;
            if ($("profileState").textContent !== "Unsaved changes") fillProfileForm();
        });

        onValue(
            query(ref(db, "appointments"), orderByChild("staffId"), equalTo(me.uid)),
            (snapshot) => {

                mine = Object.entries(snapshot.val() || {}).map(([id, value]) => ({ id, ...value }));
                loaded = true;

                render();

                const linked = new URLSearchParams(location.search).get("appt");
                if (linked && !openedFromLink) {
                    openedFromLink = true;
                    focusAppointment(linked);
                }
            },
            (error) => {
                console.error("Appointments error:", error);
                $("requestList").innerHTML = `
                    <div class="empty-state">
                        <h4>We couldn't load your appointments</h4>
                        <p>Check your connection and that the latest database rules are published, then reload.</p>
                    </div>`;
            }
        );

        onValue(ref(db, ".info/connected"), (snapshot) => {
            const online = snapshot.val() === true;
            $("livePill").classList.toggle("offline", !online);
            $("livePill").lastChild.textContent = online ? " Live" : " Reconnecting...";
        });

        // Reminders + auto-cancel, and keep the "in 20 min" labels fresh
        const tick = () => {
            if (!loaded) return;
            sweepAppointments(mine);
            render();
        };

        setTimeout(tick, 2000);
        setInterval(tick, SWEEP_MS);
    }


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

        if (user.uid === ADMIN_UID) {
            window.location.replace("../admin/admin.html");
            return;
        }

        let snap = null;

        try {
            snap = await get(ref(db, `staff/${user.uid}`));
        } catch (error) {
            console.error("Staff check failed:", error);
        }

        if (!snap?.exists() || snap.val().active === false) {
            $("accessCheck").innerHTML = `
                <h4>This page is for clinic staff</h4>
                <p>${snap?.exists() ? "Your staff account has been deactivated. Please contact the clinic admin." : "Your account isn't registered as a doctor, nurse or dentist."}</p>
                <a class="btn-primary" href="../dashboard/dashboard.html">Go to the home page</a>`;
            return;
        }

        me = user;
        profile = snap.val();

        $("greeting").textContent = `${greetingWord()}, ${staffDisplayName(profile)}`;
        $("roleLabel").textContent = `${staffTypeLabel(profile.type).toUpperCase()} DASHBOARD`;
        document.title = `${staffTypeLabel(profile.type)} Dashboard | NUFV CARES`;

        $("accessCheck").hidden = true;
        $("staffContent").hidden = false;

        mountBell(user.uid, [$("bellSlotDesktop"), $("bellSlotMobile")]);

        myPhoto = await loadAvatar(user.uid);

        renderWeekEditor();
        renderDaysOff();
        fillProfileForm();
        watch();
    });

});
