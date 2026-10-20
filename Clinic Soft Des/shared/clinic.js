// ==========================================
// SHARED CLINIC DATA + HELPERS
// Used by the patient pages and the admin page.
// ==========================================
import { REMINDERS, CLINIC_HOURS, SLOT_MINUTES } from "./config.js";
import { SERVICE_IDS, serviceName, guessService } from "./reasons.js";

export { SLOT_MINUTES, BOOKING_WINDOW_DAYS } from "./config.js";

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

// Pages live one folder below the site root (student/, admin/ ...)
export const siteUrl = (path) => new URL(`../${path}`, location.href).href;

export const patientPage = (role) =>
    role === "employee" ? "employee/em-appointment.html" : "student/st-appointment.html";

export const listOf = (value) => (value ? Object.values(value) : []);


/* =========================================
   CLINIC HOURS + SLOTS
   timeSlots/{date}/{HHMM} = appointmentId
   One appointment per 30-minute slot, whatever the reason.
   clinicClosures/{date} = "Holiday" (no bookings that day)
========================================= */

export const HOURS_TEXT =
    `${describeDays(CLINIC_HOURS.days)}, ${formatTime(CLINIC_HOURS.open)} – ${formatTime(CLINIC_HOURS.close)}`;

// Every bookable start time in a clinic day: 07:00, 07:30 ... 20:30
export const DAY_SLOTS = (() => {
    const slots = [];
    for (let m = toMinutes(CLINIC_HOURS.open); m + SLOT_MINUTES <= toMinutes(CLINIC_HOURS.close); m += SLOT_MINUTES) {
        slots.push(toTime(m));
    }
    return slots;
})();

export const isClinicDay = (dateKey, closures = {}) =>
    CLINIC_HOURS.days.includes(parseDateKey(dateKey).getDay()) && !closures[dateKey];

export const isTaken = (daySlots, time) => Boolean(daySlots && daySlots[slotKey(time)]);

// Open (future, untaken) start times on a date
export function openSlots(dateKey, daySlots, closures = {}) {
    if (!isClinicDay(dateKey, closures)) return [];
    return DAY_SLOTS.filter((time) => !isSlotPast(dateKey, time) && !isTaken(daySlots, time));
}


/* =========================================
   SERVICE + REASON
   New appointments store both. Older ones have only a reason
   (service is told from its wording) or only a service.
========================================= */

export const serviceOf = (a) =>
    SERVICE_IDS.includes(a.service) ? a.service : guessService(a.reason || a.serviceName);

export const serviceNameOf = (a) => serviceName(serviceOf(a));

export const reasonOf = (a) =>
    a.reason || a.serviceName || serviceNameOf(a) || "Clinic appointment";

// "Dental Consultation · Toothache / Tooth Pain" (for emails, notifications, exports)
export function visitLabel(a) {
    const service = serviceNameOf(a);
    const reason = reasonOf(a);
    return reason === service ? reason : `${service} · ${reason}`;
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

// Still holding a time slot
export const isActive = (a) => ["pending", "approved"].includes(statusOf(a));


/* =========================================
   APPOINTMENT TIMELINE
   appointments/{id}/history/{pushId} = { action, byRole, byName, at, note }
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
                    : ["patient", "student", "employee"].includes(h.byRole) ? "by patient"
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
