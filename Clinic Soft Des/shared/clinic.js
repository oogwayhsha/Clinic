// ==========================================
// SHARED CLINIC DATA + HELPERS
// Used by the patient, staff and admin pages.
// ==========================================
import { REMINDERS } from "./config.js";


/* =========================================
   SERVICES
   days: 0 = Sunday ... 6 = Saturday
   ranges: 24-hour start/end of bookable time
   Keep these in sync with the Schedule section of dashboard.html.
   A time can only be booked when the service is open AND a staff
   member who handles the service is working.
========================================= */

export const SLOT_MINUTES = 30;          // length of one appointment
export const BOOKING_WINDOW_DAYS = 14;   // how far ahead patients can book

export const SERVICES = {
    consultation: {
        name: "Medical Consultation",
        desc: "See a physician or nurse for check-ups, illness and other health concerns.",
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


/* =========================================
   CLINIC STAFF TYPES
   services: what a new staff member of this type handles by default
   (the admin can change it per person).
========================================= */

export const STAFF_TYPES = {
    doctor:  { label: "Doctor",  plural: "Doctors",  title: "Dr.", services: ["consultation", "certificate"] },
    nurse:   { label: "Nurse",   plural: "Nurses",   title: "",    services: ["consultation", "certificate"] },
    dentist: { label: "Dentist", plural: "Dentists", title: "Dr.", services: ["dental"] }
};

// Default weekly hours for a new staff member (they can edit their own)
export const DEFAULT_AVAILABILITY = {
    doctor:  { 1: [["08:00", "12:00"], ["13:00", "17:00"]], 2: [["08:00", "12:00"], ["13:00", "17:00"]], 3: [["08:00", "12:00"], ["13:00", "17:00"]], 4: [["08:00", "12:00"], ["13:00", "17:00"]], 5: [["08:00", "12:00"], ["13:00", "17:00"]] },
    nurse:   { 1: [["08:00", "12:00"], ["13:00", "17:00"]], 2: [["08:00", "12:00"], ["13:00", "17:00"]], 3: [["08:00", "12:00"], ["13:00", "17:00"]], 4: [["08:00", "12:00"], ["13:00", "17:00"]], 5: [["08:00", "12:00"], ["13:00", "17:00"]] },
    dentist: { 1: [["09:00", "12:00"], ["13:00", "16:00"]], 3: [["09:00", "12:00"], ["13:00", "16:00"]], 5: [["09:00", "12:00"], ["13:00", "16:00"]] }
};

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DAY_NAMES_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];


/* =========================================
   GENERAL HELPERS
========================================= */

export const pad = (n) => String(n).padStart(2, "0");

// Local date as YYYY-MM-DD (never use toISOString: it shifts the day in UTC)
export const toDateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function parseDateKey(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
}

export function toMinutes(time) {
    const [h, m] = time.split(":").map(Number);
    return h * 60 + m;
}

export const toTime = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

export function formatTime(time) {
    const [h, m] = time.split(":").map(Number);
    return `${h % 12 || 12}:${pad(m)} ${h >= 12 ? "PM" : "AM"}`;
}

export const endTime = (time) => toTime(toMinutes(time) + SLOT_MINUTES);

export const formatRange = (time) => `${formatTime(time)} – ${formatTime(endTime(time))}`;

export const formatDateLong = (key) =>
    parseDateKey(key).toLocaleDateString("en-US", {
        weekday: "long", month: "long", day: "numeric", year: "numeric"
    });

export const formatDateShort = (key) =>
    parseDateKey(key).toLocaleDateString("en-US", {
        weekday: "short", month: "short", day: "numeric"
    });

export const formatMoment = (date) =>
    date.toLocaleString("en-US", {
        weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
    });

// Realtime Database keys can't contain ":" in some tools, so store 0830
export const slotKey = (time) => time.replace(":", "");

export function slotDate(dateKey, time) {
    const [h, m] = time.split(":").map(Number);
    const when = parseDateKey(dateKey);
    when.setHours(h, m, 0, 0);
    return when;
}

export const isSlotPast = (dateKey, time) => slotDate(dateKey, time) <= new Date();

export function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

export function describeDays(days) {
    const sorted = [...days].map(Number).sort((a, b) => a - b);
    const consecutive = sorted.length > 2 &&
        sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);

    return consecutive
        ? `${DAY_NAMES[sorted[0]]} – ${DAY_NAMES[sorted[sorted.length - 1]]}`
        : sorted.map((d) => DAY_NAMES[d]).join(", ");
}

export function describeRanges(ranges) {
    return ranges
        .map(([start, end]) => `${formatTime(start)} – ${formatTime(end)}`)
        .join(", ");
}

// Every bookable start time of a service, e.g. ["08:00", "08:30", ...]
export function generateSlots(service) {
    const slots = [];

    service.ranges.forEach(([start, end]) => {
        for (let m = toMinutes(start); m + SLOT_MINUTES <= toMinutes(end); m += SLOT_MINUTES) {
            slots.push(toTime(m));
        }
    });

    return slots;
}

// Pages live one folder below the site root (student/, staff/ ...)
export const siteUrl = (path) => new URL(`../${path}`, location.href).href;

export const patientPage = (role) =>
    role === "employee" ? "employee/em-appointment.html" : "student/st-appointment.html";

export const listOf = (value) => (value ? Object.values(value) : []);


/* =========================================
   STAFF + AVAILABILITY
   staff/{uid}:    { name, email, type, services: {consultation: true},
                     availability: { 1: [["08:00","12:00"], ...] },
                     daysOff: { "2026-10-20": "Seminar" }, active }
   bookings/{date}/{staffId}/{HHMM} = appointmentId
========================================= */

export function staffDisplayName(staff) {
    if (!staff) return "";
    const title = STAFF_TYPES[staff.type]?.title;
    const name = staff.name || staff.email || "Clinic staff";
    return title && !name.startsWith(title) ? `${title} ${name}` : name;
}

export const staffTypeLabel = (type) => STAFF_TYPES[type]?.label || "Clinic staff";

export const handlesService = (staff, service) =>
    Boolean(staff?.services && staff.services[service]);

// Firebase may return the weekly hours as an array or an object
export function rangesFor(staff, dayIndex) {
    const day = staff?.availability ? staff.availability[dayIndex] : null;
    return listOf(day).map((r) => listOf(r)).filter((r) => r.length === 2);
}

export function staffWorksAt(staff, dateKey, time) {

    if (!staff || staff.active === false) return false;
    if (staff.daysOff && staff.daysOff[dateKey]) return false;

    const start = toMinutes(time);
    const end = start + SLOT_MINUTES;

    return rangesFor(staff, parseDateKey(dateKey).getDay())
        .some(([a, b]) => toMinutes(a) <= start && end <= toMinutes(b));
}

// pref: { kind: "any" } | { kind: "type", type: "doctor" } | { kind: "person", staffId }
export function eligibleStaff(staffMap, service, pref = { kind: "any" }) {
    return Object.entries(staffMap || {})
        .map(([id, s]) => ({ id, ...s }))
        .filter((s) => s.active !== false && handlesService(s, service))
        .filter((s) => {
            if (pref.kind === "type") return s.type === pref.type;
            if (pref.kind === "person") return s.id === pref.staffId;
            return true;
        });
}

export const isBooked = (dayBookings, staffId, time) =>
    Boolean(dayBookings && dayBookings[staffId] && dayBookings[staffId][slotKey(time)]);

// Staff from `candidates` who are working and free at that time
export function freeStaffAt(candidates, dayBookings, dateKey, time) {
    return candidates.filter((s) =>
        staffWorksAt(s, dateKey, time) && !isBooked(dayBookings, s.id, time));
}

// Who gets an "any available" request: the least busy that day
export function pickStaff(free, dayBookings) {
    const load = (s) => Object.keys((dayBookings && dayBookings[s.id]) || {}).length;

    return [...free].sort((a, b) =>
        load(a) - load(b) || staffDisplayName(a).localeCompare(staffDisplayName(b)))[0] || null;
}

export function prefOf(a) {
    if (a.providerPref === "person" && a.requestedStaffId) return { kind: "person", staffId: a.requestedStaffId };
    if (STAFF_TYPES[a.providerPref]) return { kind: "type", type: a.providerPref };
    return { kind: "any" };
}

export function describePref(a) {
    if (a.providerPref === "person") return "Requested this provider";
    if (STAFF_TYPES[a.providerPref]) return `Any ${STAFF_TYPES[a.providerPref].label.toLowerCase()}`;
    return "Any available provider";
}


/* =========================================
   STATUS
   status:     pending | approved | declined | cancelled | completed | missed
               (older records may say "confirmed": same as approved)
   attendance: pending | confirmed  (the patient's "I'm still coming")
========================================= */

export function statusOf(a) {
    const status = String(a.status || "pending").toLowerCase();
    return status === "confirmed" ? "approved" : status;
}

export const startOf = (a) => (a.date && a.time ? slotDate(a.date, a.time) : new Date(0));

// When the reminders go out and when an unconfirmed visit is cancelled
export function reminderTimes(a) {

    const H = 36e5;
    const start = startOf(a);

    const first = new Date(start - REMINDERS.firstHours * H);
    const deadline = new Date(start - REMINDERS.deadlineHours * H);

    let lastCall = new Date(start - REMINDERS.lastCallHours * H);
    const hour = lastCall.getHours();

    // Nobody wants a reminder at 4 AM: send it at 8 PM the evening before
    if (hour >= REMINDERS.quietStart || hour < REMINDERS.quietEnd) {
        if (hour < REMINDERS.quietEnd) lastCall.setDate(lastCall.getDate() - 1);
        lastCall.setHours(REMINDERS.quietStart - 1, 0, 0, 0);
    }

    if (lastCall < first) lastCall = first;

    return { start, first, lastCall, deadline };
}

// Approved, but the patient hasn't said they're still coming.
// (Records approved before attendance existed say "confirmed": leave those alone.)
export const needsAttendance = (a) =>
    statusOf(a) === "approved" &&
    a.attendance !== "confirmed" &&
    String(a.status).toLowerCase() !== "confirmed";

// One state that combines status, attendance and the clock
export function stateOf(a, now = new Date()) {

    const status = statusOf(a);

    if (status === "pending") return startOf(a) <= now ? "expired" : "pending";

    if (status !== "approved") return status;

    if (!needsAttendance(a)) return "attending";

    const t = reminderTimes(a);

    if (now >= t.deadline) return "lapsed";
    if (now >= t.first) return "awaiting";

    return "approved";
}

export const STATE_INFO = {
    pending:   { label: "Awaiting approval",  cls: "pending" },
    expired:   { label: "Not approved",       cls: "missed" },
    approved:  { label: "Approved",           cls: "confirmed" },
    awaiting:  { label: "Needs confirmation", cls: "awaiting" },
    lapsed:    { label: "Not confirmed",      cls: "cancelled" },
    attending: { label: "Attending",          cls: "attending" },
    completed: { label: "Completed",          cls: "completed" },
    missed:    { label: "No-show",            cls: "missed" },
    cancelled: { label: "Cancelled",          cls: "cancelled" },
    declined:  { label: "Declined",           cls: "cancelled" }
};

export function stateLabel(a, state = stateOf(a)) {
    if (state === "cancelled" && a.cancelReason === "no-confirmation") return "Auto-cancelled";
    if (state === "cancelled" && a.cancelReason === "expired") return "Not approved";
    return STATE_INFO[state]?.label || state;
}

// Still holding a time slot (blocks a double booking)
export const isActive = (a) => ["pending", "approved"].includes(statusOf(a));


/* =========================================
   APPOINTMENT TIMELINE
   appointments/{id}/history/{pushId} = { action, byRole, byName, at, note }
   (records made before this update may say "confirmed" for approved)
========================================= */

export const HISTORY_LABEL = {
    booked:           { label: "Request sent",                      cls: "pending" },
    approved:         { label: "Approved",                          cls: "confirmed" },
    confirmed:        { label: "Approved by the clinic",            cls: "confirmed" },
    passed:           { label: "Moved to another provider",         cls: "pending" },
    declined:         { label: "Declined",                          cls: "cancelled" },
    instructions:     { label: "Instructions updated",              cls: "info" },
    reminder:         { label: "Asked to confirm attendance",       cls: "pending" },
    "last-call":      { label: "Last call to confirm",              cls: "pending" },
    attending:        { label: "Patient confirmed they're coming",  cls: "confirmed" },
    cancelled:        { label: "Cancelled",                         cls: "cancelled" },
    "auto-cancelled": { label: "Auto-cancelled (not confirmed)",    cls: "cancelled" },
    expired:          { label: "Expired (not approved in time)",    cls: "missed" },
    completed:        { label: "Completed",                         cls: "completed" },
    missed:           { label: "Marked as no-show",                 cls: "missed" }
};

export function historyTimelineHtml(a) {

    const items = listOf(a.history).sort((x, y) => (Number(x.at) || 0) - (Number(y.at) || 0));

    if (!items.length) return "";

    return `
        <ul class="timeline">
            ${items.map((h) => {
                const info = HISTORY_LABEL[h.action] || { label: h.action || "Updated", cls: "info" };
                const who = h.byRole === "system" ? "automatic"
                    : h.byRole === "patient" || ["student", "employee"].includes(h.byRole) ? "by patient"
                    : h.byName ? `by ${h.byName}` : "";
                const when = h.at ? new Date(Number(h.at)).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "";

                return `
                    <li class="timeline-item ${info.cls}">
                        <strong>${escapeHtml(info.label)}</strong>
                        ${who ? `<span>${escapeHtml(who)}</span>` : ""}
                        <span>${escapeHtml(when)}</span>
                        ${h.note ? `<em>${escapeHtml(h.note)}</em>` : ""}
                    </li>`;
            }).join("")}
        </ul>`;
}


/* =========================================
   MEDICAL HISTORY
========================================= */

export const CONDITIONS = [
    "Asthma",
    "Diabetes",
    "Hypertension",
    "Heart condition",
    "Seizures / Epilepsy",
    "Thyroid disorder",
    "Kidney disease",
    "Bleeding disorder",
    "Mental health condition"
];

export function hasMedicalHistory(h) {
    return Boolean(h && (h.allergies || h.medications || h.surgeries || h.notes ||
        h.otherCondition || listOf(h.conditions).length));
}

// Read-only summary used by staff and patients
export function medicalHistoryHtml(h) {

    if (!hasMedicalHistory(h)) return '<p class="muted-text">No medical history was provided.</p>';

    const rows = [
        ["Allergies", h.allergies],
        ["Current medications", h.medications],
        ["Conditions", [...listOf(h.conditions), h.otherCondition].filter(Boolean).join(", ")],
        ["Past surgeries / hospitalizations", h.surgeries],
        ["Other notes", h.notes]
    ].filter(([, value]) => value);

    return `<dl class="history-list">${rows.map(([label, value]) =>
        `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>`;
}
