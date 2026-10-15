# NUFV CARES: setup after the doctor/nurse update

Do these once, in this order. Nothing works fully until step 1 and step 2 are done.

## 1. Publish the database rules (required)

1. Firebase Console → **Realtime Database → Rules**.
2. Replace everything with the contents of `database.rules.json`, then **Publish**.

The new pages read and write new places in the database (`staff`, `bookings`,
`notifications`, `medicalHistory`, `visitNotes`). With the old rules those requests are
refused. The rules also:

- stop two patients from booking the same provider at the same time
- let only the patient and clinic staff read medical history
- keep visit notes private to clinic staff
- refuse any password stored with an RFID card

If you had custom rules of your own, merge them in instead of overwriting.

## 2. Add the clinic staff (required)

Patients can only book times when a doctor, nurse or dentist is on duty, so **booking
shows no times until at least one staff member exists**.

1. Log in as admin → **Appointment Management → Clinic Staff → Add staff member**.
2. Enter their name, work email, role and the services they handle.
3. They get a Firebase "reset your password" email. They set a password, then log in
   with **Clinic Staff (Doctor / Nurse)** on the login page.
4. Each staff member starts with default weekly hours and can change them under
   **My Availability**.

The email must not already belong to a student or employee account.
If the password email doesn't arrive, check spam, or use **Send password email** on
their card.

## 3. Turn on email notifications (EmailJS, free tier: 200 emails/month)

Emails are sent from the clinic's Gmail through [EmailJS](https://www.emailjs.com),
because the app has no server of its own.

1. Create an EmailJS account.
2. **Email Services → Add New Service → Gmail**, and connect the clinic's Gmail account.
3. **Email Templates → Create New Template** and set:
   - **To Email:** `{{to_email}}`
   - **Subject:** `{{subject}}`
   - **Content:** switch the editor to code view and enter `{{{message_html}}}`
     (three braces, so the formatted email isn't escaped)
4. Copy the Service ID, Template ID and **Account → Public Key** into the `EMAILJS`
   settings in `shared/config.js`.
5. Recommended: **Account → Security** → allow only your site's domain.

If you skip this step, everything else still works and the emails are just skipped.
The browser console shows `[email skipped: EmailJS not configured]`.

Emails sent:

| When | To |
|---|---|
| A patient sends a request | the assigned doctor/nurse |
| A request is approved, with any pre-appointment instructions | the patient |
| A request is declined, or the clinic cancels | the patient |
| Instructions are added or changed later | the patient |
| "Are you still coming?" reminders (24 h before, then a last call) | the patient |
| A visit is auto-cancelled because it wasn't confirmed | the patient |
| A patient cancels an approved visit | the doctor/nurse |

## 4. How reminders and auto-cancel work (and the one limit)

- After approval, the patient is asked to confirm **24 hours before** the visit, and
  again at a **last call** about 4 hours before. A last call that would land at night
  moves to 8 PM the evening before.
- If they don't confirm by **2 hours before**, the appointment is cancelled, the slot is
  freed, and both sides are told.
- The doctor/nurse **Schedule** tab shows each patient's status live: *Not asked yet*,
  *Asked, no reply yet*, *Confirmed coming* or *Cancelled*.

You can change these timings in `REMINDERS` in `shared/config.js`.

**Limit:** the app has no server, so reminders are sent by whichever page of the system
is open at the time: a staff dashboard, the admin page, or the patient's own pages.
Keep a staff dashboard open at the clinic during the day and reminders go out on time.
If nothing is open, they go out as soon as anyone opens the site. To send reminders on
the dot around the clock, move `sweepAppointments` (in `shared/actions.js`) into a
scheduled Firebase Cloud Function. That requires the paid Blaze plan.

## 5. Device ("push") notifications

Users tap the bell → **Turn on**. They then get phone/desktop notifications for new
requests, approvals and reminders **while any tab of the site is open**. This needs
HTTPS, which GitHub Pages provides. True push to a closed browser would need a server
(Firebase Cloud Messaging + Cloud Functions), the same as above.

## 6. RFID / NFC card login

Tapping a card now only identifies the account. The person must still enter the account
password in a "Confirm it's you" dialog.

Older registrations saved the account **password in plain text** under
`rfid_lookup/<card>/authKey`, readable by anyone. New registrations no longer store it,
and each old entry is removed the next time that person logs in with their card.
**Delete the remaining `authKey` fields now:** Firebase Console → Realtime Database →
`rfid_lookup` → each card → delete `authKey`. Anyone who registered a card before this
update should also change their password.

## 7. Student email

Students can now register with any email (e.g. Gmail), which is where their
notifications go. Employees still need their `@nu-fairview.edu.ph` email. Change this in
`REQUIRE_NU_EMAIL` at the top of `register/register.js`.

## Old appointments

Appointments made before this update have no provider. The admin page shows them as
**Unassigned**, and the admin can still complete or cancel them.
