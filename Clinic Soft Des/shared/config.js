// ==========================================
// CLINIC SETTINGS YOU MAY NEED TO CHANGE
// ==========================================

// The hard-coded admin account (Firebase Console > Authentication > User UID).
// Also used in database.rules.json: keep both in sync.
export const ADMIN_UID = "dMcFELN1ildDnJL4AEwUxAq0SLE2";

export const CLINIC_NAME = "NUFV CARES";


/* =========================================
   EMAIL (EmailJS)
   Emails are sent straight from the browser through EmailJS, which
   delivers them from the clinic's Gmail account. See SETUP.md.
   Leave these empty and the system still works: it just skips emails
   and keeps the in-app notifications.
========================================= */

export const EMAILJS = {
    serviceId: "service_f0styy3",    // e.g. "service_abc123"
    templateId: "template_zol4md7",   // e.g. "template_xyz789"
    publicKey: "Djd00INXTvTwil_Pq"     // Account > General > Public Key
};


/* =========================================
   ATTENDANCE REMINDERS (no-show prevention)
   After a request is approved, the patient is asked to confirm they
   are still coming. If they don't confirm by the deadline, the
   appointment is cancelled and the time is opened up again.
========================================= */

export const REMINDERS = {
    firstHours: 24,     // first "are you still coming?" reminder, hours before the visit
    lastCallHours: 4,   // last call if they still haven't answered
    deadlineHours: 2,   // unconfirmed appointments are cancelled at this point
    quietStart: 21,     // don't schedule the last call between 9 PM ...
    quietEnd: 7         // ... and 7 AM: it moves to 8 PM the evening before
};

// How often open pages check for due reminders / expired confirmations
export const SWEEP_MS = 60000;
