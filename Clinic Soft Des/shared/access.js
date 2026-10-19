// ==========================================
// WHO IS CLINIC STAFF?
// Clinic staff sign in as admin. That's the main admin account
// (ADMIN_UID) plus every active record in admins/{uid}, which the
// admin adds from the admin page (Settings > Clinic staff accounts).
// ==========================================
import { db } from "../firebase/firebase.js";

import { ref, get } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

import { ADMIN_UID } from "./config.js";

export const isMainAdmin = (user) => Boolean(user) && user.uid === ADMIN_UID;

// The admins/{uid} record, or null (the main admin may not have one)
export async function adminRecord(uid) {
    try {
        const snap = await get(ref(db, `admins/${uid}`));
        return snap.exists() ? snap.val() : null;
    } catch (error) {
        return null;   // the rules refuse non-staff: that just means "no"
    }
}

export async function isClinicAdmin(user) {
    if (!user) return false;
    if (isMainAdmin(user)) return true;
    const record = await adminRecord(user.uid);
    return record?.active === true;
}
