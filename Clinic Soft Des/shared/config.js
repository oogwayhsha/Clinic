// ==========================================
// CLINIC SETTINGS YOU MAY NEED TO CHANGE
// ==========================================

// The main admin account (Firebase Console > Authentication > User UID).
// It can always sign in as admin and add the other clinic staff
// accounts from the admin page. Also used in database.rules.json:
// keep both in sync.
export const ADMIN_UID = "dMcFELN1ildDnJL4AEwUxAq0SLE2";

export const CLINIC_NAME = "NUFV CARES";

// Programs students pick from when registering and on their profile
export const PROGRAMS = [
    "BS Accountancy",
    "BSBA in Financial Management",
    "BSBA in Marketing Management",
    "BS in Computer Engineering",
    "BS in Civil Engineering",
    "BS in Information Technology",
    "BS in Architecture",
    "BA in Communication",
    "BA in Psychology",
    "BS in Hospitality Management",
    "BS in Tourism Management"
];

// Where "new appointment request" and "patient cancelled" emails go
// (the clinic's shared inbox). Leave empty to skip those emails; the
// bell on the admin page still shows them.
export const CLINIC_EMAIL = "";


/* =========================================
   CLINIC HOURS
   One appointment per 30-minute slot, whatever the reason.
   days: 0 = Sunday ... 6 = Saturday. Times are 24-hour.
   The last slot starts 30 minutes before closing (8:30 PM).
========================================= */

export const CLINIC_HOURS = {
    days: [1, 2, 3, 4, 5, 6],   // Monday to Saturday
    open: "07:00",
    close: "21:00"
};

export const SLOT_MINUTES = 30;
export const BOOKING_WINDOW_DAYS = 14;   // how far ahead patients can book

// Keeps one person from holding many slots ("ghost booking")
export const BOOKING_LIMITS = {
    perDay: 1,      // active appointments a patient may have on one day
    upcoming: 3     // active upcoming appointments in total
};


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
