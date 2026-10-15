// ==========================================
// APPOINTMENT ACTIONS
// Every status change goes through here so the database, the
// in-app notifications and the emails always agree.
//
// actor = { uid, name, role: "patient" | "staff" | "admin" }
// ==========================================
import { db } from "../firebase/firebase.js";

import {
    ref,
    get,
    set,
    push,
    update,
    runTransaction,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

import { REMINDERS } from "./config.js";

import {
    SERVICES,
    slotKey,
    formatDateLong,
    formatDateShort,
    formatTime,
    formatRange,
    formatMoment,
    siteUrl,
    patientPage,
    statusOf,
    startOf,
    reminderTimes,
    needsAttendance,
    eligibleStaff,
    freeStaffAt,
    pickStaff,
    prefOf,
    staffDisplayName
} from "./clinic.js";

import { notifyUser, sendEmail, emailLayout } from "./notify.js";


/* =========================================
   HELPERS
========================================= */

const apptPath = (a) => `appointments/${a.id}`;

export const bookingPath = (a, staffId = a.staffId) =>
    `bookings/${a.date}/${staffId}/${slotKey(a.time)}`;

// Frees the time slot an appointment was holding
function releasePaths(a) {

    if (!a.date || !a.time) return {};

    if (a.staffId) return { [bookingPath(a)]: null };

    // Appointments booked before staff assignment existed
    return a.service ? { [`slots/${a.date}/${a.service}/${slotKey(a.time)}`]: null } : {};
}

// { status: "x" } -> { "appointments/ID/status": "x" } for one atomic update
function under(a, fields) {
    const out = {};
    Object.entries(fields).forEach(([key, value]) => { out[`${apptPath(a)}/${key}`] = value; });
    return out;
}

// One timeline entry: appointments/{id}/history/{pushId}
// (spread it into the fields of the same update)
function logEntry(a, action, actor = null, note = "") {
    const key = push(ref(db, `${apptPath(a)}/history`)).key;
    return {
        [`history/${key}`]: {
            action,
            by: actor?.uid || "system",
            byRole: actor?.role || "system",
            byName: actor?.name || "",
            at: serverTimestamp(),
            note: String(note || "").slice(0, 200)
        }
    };
}

const handled = (actor) => ({
    handledBy: actor.uid,
    handledByName: actor.name || "",
    handledAt: serverTimestamp()
});

const serviceName = (a) => SERVICES[a.service]?.name || a.serviceName || "Appointment";
const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "there";
const shortWhen = (a) => `${formatDateShort(a.date)} at ${formatTime(a.time)}`;

export const patientLink = (a) => `${patientPage(a.patientRole)}?tab=mine&appt=${a.id}`;
export const staffLink = (a) => `staff/staff.html?appt=${a.id}`;

function detailRows(a) {
    return [
        ["Service", serviceName(a)],
        ["Date", a.date ? formatDateLong(a.date) : ""],
        ["Time", a.time ? formatRange(a.time) : ""],
        ["Provider", a.staffName || ""]
    ];
}

function patientRows(a) {
    return [
        ["Patient", a.patientName],
        ["ID", a.patientId],
        ["Type", a.patientRole === "employee" ? "Employee" : "Student"],
        ...detailRows(a).filter(([label]) => label !== "Provider"),
        ["Reason", a.reason || ""]
    ];
}


/* =========================================
   NEW REQUEST -> the assigned doctor / nurse
========================================= */

export async function notifyNewRequest(a, { passedFrom = "" } = {}) {

    const intro = passedFrom
        ? `${passedFrom} passed this request on to you. Please review it on your dashboard.`
        : "A new appointment request was assigned to you. Please review it on your dashboard.";

    await Promise.all([
        notifyUser(a.staffId, {
            title: passedFrom ? "Request passed to you" : "New appointment request",
            body: `${a.patientName} · ${serviceName(a)} · ${shortWhen(a)}`,
            url: staffLink(a),
            apptId: a.id,
            kind: "request"
        }),
        sendEmail({
            to: a.staffEmail,
            toName: a.staffName,
            subject: `New request: ${a.patientName}, ${shortWhen(a)}`,
            html: emailLayout({
                heading: "New appointment request",
                intro,
                rows: patientRows(a),
                blocks: [["Medical history", a.medicalHistory ? "Provided. Open the request to read it." : ""]],
                button: { label: "Review request", url: siteUrl(staffLink(a)) }
            })
        })
    ]);
}


/* =========================================
   APPROVE (doctor / nurse / admin)
========================================= */

export async function approveAppointment(a, actor, { instructions = "" } = {}) {

    const now = new Date();
    const t = reminderTimes(a);

    // Approved inside the reminder window: the approval doubles as the first reminder
    const askNow = now >= t.first && now < t.deadline;

    const fields = {
        status: "approved",
        approvedAt: serverTimestamp(),
        approvedBy: actor.uid,
        approvedByName: actor.name || "",
        instructions: instructions.trim() || null,
        // Too close to the visit to ask: the patient just requested it
        attendance: now >= t.deadline ? "confirmed" : "pending",
        ...handled(actor),
        ...logEntry(a, "approved", actor, instructions.trim() ? "Instructions sent" : "")
    };

    if (askNow) fields["reminders/first"] = Date.now();

    await update(ref(db, apptPath(a)), fields);

    const confirmBy = formatMoment(t.deadline);

    await Promise.all([
        notifyUser(a.uid, {
            title: "Appointment approved",
            body: `${serviceName(a)} with ${a.staffName} on ${shortWhen(a)}.` +
                (askNow ? ` Please confirm you're coming by ${confirmBy}.` : ""),
            url: patientLink(a),
            apptId: a.id,
            kind: "success"
        }),
        sendEmail({
            to: a.patientEmail,
            toName: a.patientName,
            subject: `Approved: ${serviceName(a)} on ${shortWhen(a)}`,
            html: emailLayout({
                heading: "Your appointment is approved",
                intro: `Hi ${firstName(a.patientName)}, your appointment request has been approved. Here are the details:`,
                rows: detailRows(a),
                blocks: [["How to prepare", instructions.trim()]],
                button: { label: askNow ? "Confirm I'm coming" : "View my appointment", url: siteUrl(patientLink(a)) },
                footer: askNow
                    ? `Please confirm by ${confirmBy}, or the appointment will be cancelled so someone else can use the time.`
                    : `We'll ask you to confirm you're still coming ${REMINDERS.firstHours} hours before your visit. Please arrive 10 minutes early and bring your ID.`
            })
        })
    ]);
}


/* =========================================
   DECLINE: pass the request to another free provider when the
   patient didn't ask for a specific person, otherwise decline it.
========================================= */

async function passToAnotherProvider(a, actor, reason) {

    const [staffSnap, daySnap] = await Promise.all([
        get(ref(db, "staff")),
        get(ref(db, `bookings/${a.date}`))
    ]);

    const passedBy = { ...(a.passedBy || {}), [a.staffId]: true };
    const dayBookings = daySnap.val() || {};

    let free = freeStaffAt(
        eligibleStaff(staffSnap.val(), a.service, prefOf(a)).filter((s) => !passedBy[s.id]),
        dayBookings, a.date, a.time
    );

    // Try the least busy first; if someone grabs that time first, try the next
    while (free.length) {

        const next = pickStaff(free, dayBookings);
        free = free.filter((s) => s.id !== next.id);

        const moved = {
            ...a,
            staffId: next.id,
            staffName: staffDisplayName(next),
            staffType: next.type || "",
            staffEmail: next.email || ""
        };

        try {
            await update(ref(db), {
                ...releasePaths(a),
                [bookingPath(a, next.id)]: a.id,
                ...under(a, {
                    staffId: moved.staffId,
                    staffName: moved.staffName,
                    staffType: moved.staffType,
                    staffEmail: moved.staffEmail,
                    [`passedBy/${a.staffId}`]: true,
                    passNote: reason || null,
                    ...handled(actor),
                    ...logEntry(a, "passed", actor, `Passed to ${moved.staffName}`)
                })
            });
        } catch (error) {
            console.warn("Couldn't pass to", moved.staffName, error);
            continue;
        }

        await Promise.all([
            notifyNewRequest(moved, { passedFrom: actor.name }),
            notifyUser(a.uid, {
                title: "Your request was moved",
                body: `${serviceName(a)} on ${shortWhen(a)} is now with ${moved.staffName}. It's still waiting for approval.`,
                url: patientLink(a),
                apptId: a.id
            })
        ]);

        return moved;
    }

    return null;
}

export async function declineAppointment(a, actor, { reason = "", passOn = true } = {}) {

    if (passOn && a.providerPref !== "person") {
        const moved = await passToAnotherProvider(a, actor, reason);
        if (moved) return { passedTo: moved.staffName };
    }

    await update(ref(db), {
        ...releasePaths(a),
        ...under(a, {
            status: "declined",
            declinedAt: serverTimestamp(),
            declineReason: reason.trim() || null,
            ...handled(actor),
            ...logEntry(a, "declined", actor, reason)
        })
    });

    await Promise.all([
        notifyUser(a.uid, {
            title: "Request declined",
            body: `${serviceName(a)} on ${shortWhen(a)}.` + (reason ? ` ${reason}` : " Please book another time."),
            url: patientLink(a),
            apptId: a.id,
            kind: "danger"
        }),
        sendEmail({
            to: a.patientEmail,
            toName: a.patientName,
            subject: `Request declined: ${serviceName(a)} on ${shortWhen(a)}`,
            html: emailLayout({
                heading: "Your request couldn't be accepted",
                intro: `Hi ${firstName(a.patientName)}, sorry, the clinic couldn't accept this appointment request.`,
                rows: detailRows(a),
                blocks: [["Note from the clinic", reason.trim()]],
                button: { label: "Book another time", url: siteUrl(patientPage(a.patientRole)) }
            })
        })
    ]);

    return { passedTo: null };
}


/* =========================================
   CANCEL (patient, staff or admin)
========================================= */

export async function cancelAppointment(a, actor, { note = "" } = {}) {

    const fields = {
        status: "cancelled",
        cancelledAt: serverTimestamp(),
        cancelledBy: actor.role,
        ...handled(actor),
        ...logEntry(a, "cancelled", actor, actor.role === "patient" ? "" : note)
    };

    if (actor.role !== "patient") fields.clinicNote = note.trim() || null;

    await update(ref(db), { ...releasePaths(a), ...under(a, fields) });

    if (actor.role === "patient") {

        await Promise.all([
            notifyUser(a.staffId, {
                title: "Appointment cancelled by patient",
                body: `${a.patientName} cancelled ${serviceName(a)} on ${shortWhen(a)}. The time is open again.`,
                url: staffLink(a),
                apptId: a.id,
                kind: "danger"
            }),
            // Approved visits were on the provider's schedule: tell them by email too
            statusOf(a) === "approved" && sendEmail({
                to: a.staffEmail,
                toName: a.staffName,
                subject: `Cancelled: ${a.patientName}, ${shortWhen(a)}`,
                html: emailLayout({
                    heading: "A patient cancelled",
                    intro: `${a.patientName} cancelled their appointment. The time slot is open again.`,
                    rows: patientRows(a)
                })
            })
        ]);

        return;
    }

    await Promise.all([
        notifyUser(a.uid, {
            title: "Appointment cancelled by the clinic",
            body: `${serviceName(a)} on ${shortWhen(a)}.` + (note ? ` ${note}` : ""),
            url: patientLink(a),
            apptId: a.id,
            kind: "danger"
        }),
        sendEmail({
            to: a.patientEmail,
            toName: a.patientName,
            subject: `Cancelled: ${serviceName(a)} on ${shortWhen(a)}`,
            html: emailLayout({
                heading: "Your appointment was cancelled",
                intro: `Hi ${firstName(a.patientName)}, the clinic had to cancel your appointment.`,
                rows: detailRows(a),
                blocks: [["Note from the clinic", note.trim()]],
                button: { label: "Book another time", url: siteUrl(patientPage(a.patientRole)) }
            })
        }),
        // The admin cancelled someone else's appointment: tell the provider
        actor.uid !== a.staffId && notifyUser(a.staffId, {
            title: "Appointment cancelled",
            body: `${actor.name || "The clinic"} cancelled ${a.patientName}'s visit on ${shortWhen(a)}.`,
            url: staffLink(a),
            apptId: a.id,
            kind: "danger"
        })
    ]);
}


/* =========================================
   PATIENT: "Yes, I'm still coming"
========================================= */

export async function confirmAttendance(a, actor) {

    await update(ref(db, apptPath(a)), {
        attendance: "confirmed",
        attendanceAt: serverTimestamp(),
        ...logEntry(a, "attending", actor)
    });

    await notifyUser(a.staffId, {
        title: "Patient confirmed attendance",
        body: `${a.patientName} will come to ${serviceName(a)} on ${shortWhen(a)}.`,
        url: staffLink(a),
        apptId: a.id,
        kind: "success"
    });
}


/* =========================================
   STAFF: instructions, completed, no-show
========================================= */

export async function updateInstructions(a, actor, text) {

    const instructions = text.trim();

    await update(ref(db, apptPath(a)), {
        instructions: instructions || null,
        instructionsUpdatedAt: serverTimestamp(),
        ...handled(actor),
        ...logEntry(a, "instructions", actor)
    });

    if (!instructions) return;

    await Promise.all([
        notifyUser(a.uid, {
            title: "New instructions for your visit",
            body: instructions,
            url: patientLink(a),
            apptId: a.id
        }),
        sendEmail({
            to: a.patientEmail,
            toName: a.patientName,
            subject: `How to prepare: ${serviceName(a)} on ${shortWhen(a)}`,
            html: emailLayout({
                heading: "Instructions for your visit",
                intro: `Hi ${firstName(a.patientName)}, ${a.staffName || "the clinic"} sent instructions for your upcoming appointment.`,
                rows: detailRows(a),
                blocks: [["How to prepare", instructions]],
                button: { label: "View my appointment", url: siteUrl(patientLink(a)) }
            })
        })
    ]);
}

export async function completeAppointment(a, actor, { notes = "" } = {}) {

    const changes = under(a, {
        status: "completed",
        completedAt: serverTimestamp(),
        ...handled(actor),
        ...logEntry(a, "completed", actor)
    });

    // Visit notes live outside the appointment so only clinic staff can read them
    if (notes.trim()) {
        changes[`visitNotes/${a.id}`] = {
            text: notes.trim(),
            by: actor.uid,
            byName: actor.name || "",
            at: serverTimestamp()
        };
    }

    await update(ref(db), changes);
}

export async function saveVisitNotes(a, actor, notes) {
    await set(ref(db, `visitNotes/${a.id}`), notes.trim() ? {
        text: notes.trim(),
        by: actor.uid,
        byName: actor.name || "",
        at: serverTimestamp()
    } : null);
}

export async function markMissed(a, actor) {

    await update(ref(db, apptPath(a)), {
        status: "missed",
        ...handled(actor),
        ...logEntry(a, "missed", actor)
    });

    await notifyUser(a.uid, {
        title: "Marked as a no-show",
        body: `You missed ${serviceName(a)} on ${shortWhen(a)}. Please cancel ahead next time so someone else can use the slot.`,
        url: patientLink(a),
        apptId: a.id
    });
}


/* =========================================
   REMINDER SWEEP
   There's no server, so whichever page is open (the clinic's dashboard,
   the admin page or the patient's own pages) sends the reminders that
   are due and cancels visits nobody confirmed. A transaction "claims"
   each step, so two open pages never send the same reminder twice.
========================================= */

async function claim(a, step) {
    try {
        const result = await runTransaction(
            ref(db, `${apptPath(a)}/reminders/${step}`),
            (current) => (current ? undefined : Date.now())
        );
        return result.committed;
    } catch (error) {
        console.warn("Reminder claim failed:", error);
        return false;
    }
}

async function sendReminder(a, { lastCall }) {

    const deadline = formatMoment(reminderTimes(a).deadline);

    await update(ref(db, apptPath(a)), logEntry(a, lastCall ? "last-call" : "reminder", null))
        .catch((error) => console.warn("Couldn't record the reminder:", error));

    await Promise.all([
        notifyUser(a.uid, {
            title: lastCall ? "Last call: are you still coming?" : "Are you still coming?",
            body: `${serviceName(a)} with ${a.staffName} on ${shortWhen(a)}. Confirm by ${deadline} or it will be cancelled.`,
            url: patientLink(a),
            apptId: a.id,
            kind: "reminder"
        }),
        sendEmail({
            to: a.patientEmail,
            toName: a.patientName,
            subject: `${lastCall ? "Last call" : "Reminder"}: please confirm your ${serviceName(a)} on ${shortWhen(a)}`,
            html: emailLayout({
                heading: lastCall ? "Last call: please confirm your visit" : "Are you still coming?",
                intro: `Hi ${firstName(a.patientName)}, you have an appointment coming up. Please let us know if you're still coming.`,
                rows: detailRows(a),
                blocks: [["How to prepare", a.instructions || ""]],
                button: { label: "Confirm or cancel", url: siteUrl(patientLink(a)) },
                footer: `If you don't confirm by ${deadline}, the appointment will be cancelled automatically so another patient can use the time.`
            })
        })
    ]);
}

async function autoCancel(a) {

    await update(ref(db), {
        ...releasePaths(a),
        ...under(a, {
            status: "cancelled",
            cancelledAt: serverTimestamp(),
            cancelledBy: "system",
            cancelReason: "no-confirmation",
            ...logEntry(a, "auto-cancelled", null, "Not confirmed in time")
        })
    });

    await Promise.all([
        notifyUser(a.uid, {
            title: "Appointment cancelled: not confirmed",
            body: `${serviceName(a)} on ${shortWhen(a)} was cancelled because it wasn't confirmed in time.`,
            url: patientLink(a),
            apptId: a.id,
            kind: "danger"
        }),
        notifyUser(a.staffId, {
            title: "Auto-cancelled (no confirmation)",
            body: `${a.patientName}'s ${serviceName(a)} on ${shortWhen(a)} was cancelled. The time is open again.`,
            url: staffLink(a),
            apptId: a.id,
            kind: "danger"
        }),
        sendEmail({
            to: a.patientEmail,
            toName: a.patientName,
            subject: `Cancelled: ${serviceName(a)} on ${shortWhen(a)} (not confirmed)`,
            html: emailLayout({
                heading: "Your appointment was cancelled",
                intro: `Hi ${firstName(a.patientName)}, we didn't hear back from you, so your appointment was cancelled and the time was given to other patients.`,
                rows: detailRows(a),
                button: { label: "Book again", url: siteUrl(patientPage(a.patientRole)) }
            })
        })
    ]);
}

async function expireRequest(a) {

    await update(ref(db), {
        ...releasePaths(a),
        ...under(a, {
            status: "cancelled",
            cancelledAt: serverTimestamp(),
            cancelledBy: "system",
            cancelReason: "expired",
            ...logEntry(a, "expired", null, "Not approved before the visit time")
        })
    });

    await notifyUser(a.uid, {
        title: "Request not approved in time",
        body: `${serviceName(a)} on ${shortWhen(a)} wasn't approved before the visit time. Please book again.`,
        url: patientLink(a),
        apptId: a.id,
        kind: "danger"
    });
}

let sweeping = false;

export async function sweepAppointments(list) {

    if (sweeping) return;
    sweeping = true;

    try {

        const now = new Date();

        for (const a of list) {

            if (!a.date || !a.time || !a.uid) continue;

            const status = statusOf(a);
            const sent = a.reminders || {};

            if (status === "pending") {
                if (startOf(a) <= now && await claim(a, "expired")) await expireRequest(a);
                continue;
            }

            if (!needsAttendance(a)) continue;

            const t = reminderTimes(a);

            if (now >= t.deadline) {
                if (await claim(a, "autoCancel")) await autoCancel(a);
            } else if (now >= t.lastCall && !sent.lastCall) {
                if (await claim(a, "lastCall")) {
                    if (!sent.first) await claim(a, "first");
                    await sendReminder(a, { lastCall: true });
                }
            } else if (now >= t.first && !sent.first) {
                if (await claim(a, "first")) await sendReminder(a, { lastCall: false });
            }
        }

    } finally {
        sweeping = false;
    }
}
