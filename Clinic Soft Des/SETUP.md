# NUFV CARES: setup

How the system works now (from the clinic interview):

- **One appointment per 30-minute slot**, whatever the reason.
- **Clinic hours:** Monday to Saturday, 7:00 AM – 9:00 PM. The last slot starts at 8:30 PM.
- **Accounts:** students and employees book. **Clinic staff** sign in as **Admin**; each staff member has their own login.
- **Booking:** patients pick a reason from a list the clinic edits. The clinic approves or declines each request.
- **Emails and reminders:** the patient gets an email when a request is approved. A day before the visit they're asked to confirm they're still coming. An unconfirmed visit is cancelled automatically so someone else can use the slot.

Do steps 1–3 once, in order.

## 1. Publish the database rules (required)

1. Firebase Console → **Realtime Database → Rules**.
2. Replace everything with the contents of `database.rules.json`, then **Publish**.

The pages read and write `timeSlots`, `bookingReasons`, `clinicClosures`, `admins` and `notifications/clinic`. The old rules refuse these, so nothing works until the new rules are published.

## 2. Sign in as the main admin and add the clinic staff

The main admin is the account whose UID is `ADMIN_UID` in `shared/config.js` (and in the rules).

1. Log in with **Admin / Clinic Staff** selected.
2. Go to **Settings → Clinic staff accounts → Add clinic staff**, and enter each nurse's, doctor's or staff member's name, email and position.
3. They get a "set your password" email (check spam). After setting a password, they log in with **Admin / Clinic Staff** and see the same admin page.
4. **Remove access** blocks someone without deleting their history.

The email must not already belong to a student or employee account.

## 3. Check the booking reasons and closures

**Settings → Reasons patients can choose:**

- The first time an admin opens the page, the default list is saved here.
- Add, rename, reorder, switch off or delete reasons.
- Switched-off and deleted reasons disappear from the booking page. Past appointments keep their reason text.

**Settings → Clinic closures:**

- Close a date (holiday, school event) and patients can't book it.
- If appointments already exist that day, the page warns you so you can cancel them.

## Email notifications (EmailJS)

The EmailJS keys are already in `shared/config.js`. The template needs:

- **To Email:** `{{to_email}}`
- **Subject:** `{{subject}}`
- **Content:** `{{{message_html}}}`
- **From Name:** `NUFV CARES`

To also email the clinic about new requests and patient cancellations, put the clinic's inbox in `CLINIC_EMAIL` in `shared/config.js`. Without it, those alerts only appear in the bell on the admin page.

| When | Email to |
|---|---|
| A request is approved (with any instructions) | patient |
| A request is declined, or the clinic cancels | patient |
| Instructions are added later | patient |
| "Are you still coming?" (24 h before, then a last call) | patient |
| A visit is auto-cancelled (not confirmed) | patient |
| A new request comes in | clinic (`CLINIC_EMAIL`) |
| A patient cancels an approved visit | clinic (`CLINIC_EMAIL`) |

Recommended: in EmailJS, **Account → Security**, allow only your site's domain.

## Reminders and auto-cancel (one limit)

There's no server, so reminders and auto-cancellations are done by whichever page of the system is open: the admin page, or the patient's own pages. Keep the admin page open at the clinic during the day and they run on time. To run them with nothing open, move `sweepAppointments` (`shared/actions.js`) into a scheduled Firebase Cloud Function, which needs the paid Blaze plan.

You can change the timings (24 h / last call / 2 h deadline) in `REMINDERS` in `shared/config.js`.

## Changing clinic rules

Everything is in `shared/config.js`:

- `CLINIC_HOURS`: days and open/close times. Also update the hours table in `dashboard/dashboard.html`.
- `SLOT_MINUTES`, `BOOKING_WINDOW_DAYS`: slot length and how far ahead patients can book.
- `BOOKING_LIMITS`: how many active appointments one patient can hold. The defaults are 1 per day and 3 upcoming.

## Cleaning up data from the earlier version

The doctor/nurse version left data the system no longer uses. It's harmless, but you can delete these nodes in Firebase Console → Realtime Database:

- `staff`, `bookings`, `slots`: replaced by `admins` and `timeSlots`.
- `medicalHistory`, `visitNotes`: removed at the clinic's request.
- `rfid_lookup/<card>/authKey`: old saved passwords. **Delete these**, and anyone who registered a card before should change their password.

Upcoming appointments made before this version are moved onto the new slot system automatically the first time an admin opens the admin page. If two of them happen to share a slot, both are tagged **Double-booked** so staff can cancel one.

## RFID / NFC card login

Tapping a card only identifies the account; the person still types their password. This applies to students and employees.
