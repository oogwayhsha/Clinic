// ==========================================
// APPOINTMENT ACTIONS
// Every status change goes through here so the database, the
// in-app notifications and the emails always agree.
//
// actor = { uid, name, role: "patient" | "admin" }
// The clinic's shared inbox is the "clinic" notification channel,
// which every admin / clinic staff account sees.
// ==========================================
import { db } from "../firebase/firebase.js";

import {
    ref,
    get,
    push,
    update,
    runTransaction,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

import { REMINDERS, CLINIC_EMAIL } from "./config.js";

import {
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
    reasonOf,
    serviceNameOf,
    visitLabel
} from "./clinic.js";

import { notifyUser, sendEmail, emailLayout } from "./notify.js";

export const CLINIC_CHANNEL = "clinic";


/* =========================================
   HELPERS
========================================= */

const apptPath = (a) => `appointments/${a.id}`;

export const slotPath = (a) => `timeSlots/${a.date}/${slotKey(a.time)}`;

// Frees the appointment's time slot, but only if it is still holding it
async function releaseChanges(a) {

    if (!a.date || !a.time) return {};

    try {
        const snap = await get(ref(db, slotPath(a)));
        return snap.val() === a.id ? { [slotPath(a)]: null } : {};
    } catch (error) {
        console.warn("Couldn't check the time slot:", error);
        return {};
    }
}

// { status: "x" } -> { "appointments/ID/status": "x" } for one atomic update
function under(a, fields) {
    const out = {};
    Object.entries(fields).forEach(([key, value]) => { out[`${apptPath(a)}/${key}`] = value; });
    return out;
}

// One timeline entry: appointments/{id}/history/{pushId}
// (spread it into the fields of the same update)
export function logEntry(a, action, actor = null, note = "") {
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

const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "there";
const shortWhen = (a) => `${formatDateShort(a.date)} at ${formatTime(a.time)}`;

export const patientLink = (a) => `${patientPage(a.patientRole)}?tab=mine&appt=${a.id}`;
export const adminLink = (a) => `admin/admin.html?appt=${a.id}`;

function detailRows(a) {
    return [
        ["Service", serviceNameOf(a)],
        ["Reason", reasonOf(a)],
        ["Date", a.date ? formatDateLong(a.date) : ""],
        ["Time", a.time ? formatRange(a.time) : ""]
    ];
}

function patientRows(a) {
    return [
        ["Patient", a.patientName],
        ["ID", a.patientId],
        ["Type", a.patientRole === "employee" ? "Employee" : "Student"],
        ["Email", a.patientEmail],
        ...detailRows(a)
    ];
}

const toClinic = (a, { title, body, kind = "info" }) =>
    notifyUser(CLINIC_CHANNEL, { title, body, url: adminLink(a), apptId: a.id, kind });

const emailClinic = (a, { subject, heading, intro }) =>
    CLINIC_EMAIL && sendEmail({
        to: CLINIC_EMAIL,
        toName: "Clinic",
        subject,
        html: emailLayout({
            heading,
            intro,
            rows: patientRows(a),
            button: { label: "Open the admin page", url: siteUrl(adminLink(a)) }
        })
    });


/* =========================================
   NEW REQUEST -> the clinic
========================================= */

export async function notifyNewRequest(a) {
    await Promise.all([
        toClinic(a, {
            title: "New appointment request",
            body: `${a.patientName} · ${visitLabel(a)} · ${shortWhen(a)}`,
            kind: "request"
        }),
        emailClinic(a, {
            subject: `New request: ${a.patientName}, ${shortWhen(a)}`,
            heading: "New appointment request",
            intro: "A new appointment request is waiting for approval."
        })
    ]);
}


/* =========================================
   APPROVE (clinic staff)
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
            body: `${visitLabel(a)} on ${shortWhen(a)}.` + (askNow ? ` Please confirm you're coming by ${confirmBy}.` : ""),
            url: patientLink(a),
            apptId: a.id,
            kind: "success"
        }),
        sendEmail({
            to: a.patientEmail,
            toName: a.patientName,
            subject: `Approved: your clinic appointment on ${shortWhen(a)}`,
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
   DECLINE (clinic staff)
========================================= */

export async function declineAppointment(a, actor, { reason = "" } = {}) {

    await update(ref(db), {
        ...(await releaseChanges(a)),
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
            body: `${visitLabel(a)} on ${shortWhen(a)}.` + (reason ? ` ${reason}` : " Please book another time."),
            url: patientLink(a),
            apptId: a.id,
            kind: "danger"
        }),
        sendEmail({
            to: a.patientEmail,
            toName: a.patientName,
            subject: `Request declined: your clinic appointment on ${shortWhen(a)}`,
            html: emailLayout({
                heading: "Your request couldn't be accepted",
                intro: `Hi ${firstName(a.patientName)}, sorry, the clinic couldn't accept this appointment request.`,
                rows: detailRows(a),
                blocks: [["Note from the clinic", reason.trim()]],
                button: { label: "Book another time", url: siteUrl(patientPage(a.patientRole)) }
            })
        })
    ]);
}


/* =========================================
   CANCEL (patient or clinic staff)
========================================= */

export async function cancelAppointment(a, actor, { note = "" } = {}) {

    const wasApproved = statusOf(a) === "approved";

    const fields = {
        status: "cancelled",
        cancelledAt: serverTimestamp(),
        cancelledBy: actor.role,
        ...handled(actor),
        ...logEntry(a, "cancelled", actor, actor.role === "patient" ? "" : note)
    };

    if (actor.role !== "patient") fields.clinicNote = note.trim() || null;

    await update(ref(db), { ...(await releaseChanges(a)), ...under(a, fields) });

    if (actor.role === "patient") {

        await Promise.all([
            toClinic(a, {
                title: "Appointment cancelled by patient",
                body: `${a.patientName} cancelled ${shortWhen(a)}. The slot is open again.`,
                kind: "danger"
            }),
            // Approved visits were on the schedule: email the clinic too
            wasApproved && emailClinic(a, {
                subject: `Cancelled: ${a.patientName}, ${shortWhen(a)}`,
                heading: "A patient cancelled",
                intro: `${a.patientName} cancelled their approved appointment. The slot is open again.`
            })
        ]);

        return;
    }

    await Promise.all([
        notifyUser(a.uid, {
            title: "Appointment cancelled by the clinic",
            body: `${visitLabel(a)} on ${shortWhen(a)}.` + (note ? ` ${note}` : ""),
            url: patientLink(a),
            apptId: a.id,
            kind: "danger"
        }),
        sendEmail({
            to: a.patientEmail,
            toName: a.patientName,
            subject: `Cancelled: your clinic appointment on ${shortWhen(a)}`,
            html: emailLayout({
                heading: "Your appointment was cancelled",
                intro: `Hi ${firstName(a.patientName)}, the clinic had to cancel your appointment.`,
                rows: detailRows(a),
                blocks: [["Note from the clinic", note.trim()]],
                button: { label: "Book another time", url: siteUrl(patientPage(a.patientRole)) }
            })
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

    await toClinic(a, {
        title: "Patient confirmed attendance",
        body: `${a.patientName} will come on ${shortWhen(a)}.`,
        kind: "success"
    });
}


/* =========================================
   CLINIC STAFF: instructions, completed, no-show
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
            subject: `How to prepare: your clinic appointment on ${shortWhen(a)}`,
            html: emailLayout({
                heading: "Instructions for your visit",
                intro: `Hi ${firstName(a.patientName)}, the clinic sent instructions for your upcoming appointment.`,
                rows: detailRows(a),
                blocks: [["How to prepare", instructions]],
                button: { label: "View my appointment", url: siteUrl(patientLink(a)) }
            })
        })
    ]);
}

export async function completeAppointment(a, actor) {
    await update(ref(db, apptPath(a)), {
        status: "completed",
        completedAt: serverTimestamp(),
        ...handled(actor),
        ...logEntry(a, "completed", actor)
    });
}

export async function markMissed(a, actor) {

    await update(ref(db, apptPath(a)), {
        status: "missed",
        ...handled(actor),
        ...logEntry(a, "missed", actor)
    });

    await notifyUser(a.uid, {
        title: "Marked as a no-show",
        body: `You missed your appointment on ${shortWhen(a)}. Please cancel ahead next time so someone else can use the slot.`,
        url: patientLink(a),
        apptId: a.id
    });
}


/* =========================================
   REMINDER SWEEP
   There's no server, so whichever page is open (the admin page or the
   patient's own pages) sends the reminders that are due and cancels
   visits nobody confirmed. A transaction "claims" each step, so two
   open pages never send the same reminder twice.
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
            body: `Your clinic appointment on ${shortWhen(a)}. Confirm by ${deadline} or it will be cancelled.`,
            url: patientLink(a),
            apptId: a.id,
            kind: "reminder"
        }),
        sendEmail({
            to: a.patientEmail,
            toName: a.patientName,
            subject: `${lastCall ? "Last call" : "Reminder"}: please confirm your clinic appointment on ${shortWhen(a)}`,
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
        ...(await releaseChanges(a)),
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
            body: `Your appointment on ${shortWhen(a)} was cancelled because it wasn't confirmed in time.`,
            url: patientLink(a),
            apptId: a.id,
            kind: "danger"
        }),
        toClinic(a, {
            title: "Auto-cancelled (no confirmation)",
            body: `${a.patientName}'s appointment on ${shortWhen(a)} was cancelled. The slot is open again.`,
            kind: "danger"
        }),
        sendEmail({
            to: a.patientEmail,
            toName: a.patientName,
            subject: `Cancelled: your clinic appointment on ${shortWhen(a)} (not confirmed)`,
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
        ...(await releaseChanges(a)),
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
        body: `Your request for ${shortWhen(a)} wasn't approved before the visit time. Please book again.`,
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
