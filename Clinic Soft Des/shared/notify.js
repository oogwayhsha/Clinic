// ==========================================
// NOTIFICATIONS
// - In-app:  notifications/{uid}/{id}  (the bell in the header, live)
// - Device:  browser/phone notifications while the site is open
// - Email:   EmailJS (see config.js and SETUP.md)
// ==========================================
import { auth, db } from "../firebase/firebase.js";

import {
    ref,
    push,
    update,
    query,
    limitToLast,
    onValue,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

import { EMAILJS, CLINIC_NAME } from "./config.js";
import { escapeHtml } from "./clinic.js";

// Notification links are stored relative to the site root ("student/st-appointment.html?...")
const resolveUrl = (url) => new URL(url, new URL("../", location.href)).href;


/* =========================================
   IN-APP NOTIFICATIONS
========================================= */

// Never throws: a failed notification must not undo the action that caused it
export async function notifyUser(uid, { title, body = "", url = "", apptId = "", kind = "info" }) {

    if (!uid || !auth.currentUser) return false;

    try {
        await push(ref(db, `notifications/${uid}`), {
            title: String(title).slice(0, 120),
            body: String(body).slice(0, 500),
            url,
            apptId,
            kind,
            from: auth.currentUser.uid,
            read: false,
            createdAt: serverTimestamp()
        });
        return true;
    } catch (error) {
        console.warn("Could not save notification:", error);
        return false;
    }
}


/* =========================================
   EMAIL (EmailJS REST API, no SDK needed)
   The EmailJS template only needs:
     To Email: {{to_email}}   Subject: {{subject}}   Content: {{{message_html}}}
========================================= */

export const emailEnabled = () =>
    Boolean(EMAILJS.serviceId && EMAILJS.templateId && EMAILJS.publicKey);

export async function sendEmail({ to, toName = "", subject, html }) {

    if (!to) return false;

    if (!emailEnabled()) {
        console.info(`[email skipped: EmailJS not configured] To ${to}: ${subject}`);
        return false;
    }

    try {
        const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                service_id: EMAILJS.serviceId,
                template_id: EMAILJS.templateId,
                user_id: EMAILJS.publicKey,
                template_params: {
                    to_email: to,
                    to_name: toName,
                    subject,
                    message_html: html,
                    clinic_name: CLINIC_NAME
                }
            })
        });

        if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);

        return true;

    } catch (error) {
        console.warn("Email could not be sent:", error);
        return false;
    }
}

// A simple, email-client-safe layout (inline styles only)
export function emailLayout({ heading, intro = "", rows = [], blocks = [], button = null, footer = "" }) {

    const rowHtml = rows
        .filter(([, value]) => value)
        .map(([label, value]) => `
            <tr>
                <td style="padding:8px 0;color:#718096;font-size:13px;width:140px;vertical-align:top;">${escapeHtml(label)}</td>
                <td style="padding:8px 0;color:#0b1c4e;font-size:14px;font-weight:600;">${escapeHtml(value)}</td>
            </tr>`)
        .join("");

    const blockHtml = blocks
        .filter(([, text]) => text)
        .map(([title, text]) => `
            <div style="margin:18px 0 0;padding:14px 16px;background:#fff8ee;border-left:4px solid #c87c28;border-radius:6px;">
                <div style="color:#9a5b12;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;">${escapeHtml(title)}</div>
                <div style="color:#18233a;font-size:14px;line-height:1.55;white-space:pre-line;">${escapeHtml(text)}</div>
            </div>`)
        .join("");

    const buttonHtml = button ? `
        <div style="margin:24px 0 4px;">
            <a href="${escapeHtml(button.url)}" style="display:inline-block;background:#0b1c4e;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:8px;">${escapeHtml(button.label)}</a>
        </div>` : "";

    return `
        <div style="font-family:Arial,Helvetica,sans-serif;background:#f6f8fc;padding:24px 12px;">
            <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e7ebf2;border-radius:12px;overflow:hidden;">
                <div style="background:#0b1c4e;padding:18px 24px;color:#ffffff;font-size:16px;font-weight:700;letter-spacing:.04em;">
                    ${escapeHtml(CLINIC_NAME)}
                </div>
                <div style="padding:24px;">
                    <h2 style="margin:0 0 10px;color:#0b1c4e;font-size:20px;">${escapeHtml(heading)}</h2>
                    ${intro ? `<p style="margin:0 0 14px;color:#4e5b70;font-size:14px;line-height:1.6;">${escapeHtml(intro)}</p>` : ""}
                    ${rowHtml ? `<table style="width:100%;border-collapse:collapse;border-top:1px solid #e7ebf2;">${rowHtml}</table>` : ""}
                    ${blockHtml}
                    ${buttonHtml}
                    <p style="margin:22px 0 0;color:#718096;font-size:12px;line-height:1.5;">
                        ${escapeHtml(footer || "This is an automated message from the university clinic appointment system.")}
                    </p>
                </div>
            </div>
        </div>`;
}


/* =========================================
   DEVICE NOTIFICATIONS
   Phones (Android Chrome) only show notifications through a service
   worker, so sw.js is registered from the site root.
========================================= */

let swRegistration = null;

export async function registerServiceWorker() {

    if (!("serviceWorker" in navigator)) return null;

    try {
        swRegistration = await navigator.serviceWorker.register(new URL("../sw.js", location.href), {
            scope: new URL("../", location.href).pathname
        });
        return swRegistration;
    } catch (error) {
        console.warn("Service worker not registered:", error);
        return null;
    }
}

export const deviceNotificationsSupported = () => "Notification" in window;

export async function enableDeviceNotifications() {

    if (!deviceNotificationsSupported()) return "unsupported";

    const permission = await Notification.requestPermission();

    if (permission === "granted") {
        await registerServiceWorker();
        showDeviceNotification("Notifications are on", "You'll get appointment updates and reminders here.");
    }

    return permission;
}

export async function showDeviceNotification(title, body, url = "") {

    if (!deviceNotificationsSupported() || Notification.permission !== "granted") return;

    const options = {
        body,
        icon: new URL("../login/nu-logo.png", location.href).href,
        badge: new URL("../login/nu-logo.png", location.href).href,
        data: { url: url || location.href },
        tag: `${title}-${Date.now()}`
    };

    try {
        const registration = swRegistration || await navigator.serviceWorker?.getRegistration?.();

        if (registration) {
            await registration.showNotification(title, options);
        } else {
            new Notification(title, options);
        }
    } catch (error) {
        console.warn("Device notification failed:", error);
    }
}


/* =========================================
   NOTIFICATION BELL
   mountBell(uid, [container, ...]) adds a bell button to each container
   (e.g. desktop nav + mobile header). All buttons share one panel.
========================================= */

const BELL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>';

function timeAgo(ms) {

    if (!ms) return "just now";

    const minutes = Math.round((Date.now() - ms) / 60000);

    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;

    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;

    return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function mountBell(uid, containers) {

    const targets = containers.filter(Boolean);

    if (!uid || targets.length === 0) return;

    registerServiceWorker();

    const mountedAt = Date.now();
    const seen = new Set();
    let items = [];

    const buttons = targets.map((container) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "bell-btn";
        button.setAttribute("aria-label", "Notifications");
        button.setAttribute("aria-haspopup", "true");
        button.innerHTML = `${BELL_SVG}<span class="bell-count" hidden>0</span>`;
        container.prepend(button);
        return button;
    });

    const panel = document.createElement("div");
    panel.className = "bell-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Notifications");
    panel.hidden = true;
    document.body.appendChild(panel);

    function unread() {
        return items.filter((n) => !n.read);
    }

    function render() {

        const count = unread().length;

        buttons.forEach((button) => {
            const badge = button.querySelector(".bell-count");
            badge.textContent = count > 9 ? "9+" : count;
            badge.hidden = count === 0;
        });

        const showEnable = deviceNotificationsSupported() && Notification.permission === "default";

        panel.innerHTML = `
            <div class="bell-head">
                <strong>Notifications</strong>
                ${count ? '<button type="button" class="bell-link" data-read-all>Mark all read</button>' : ""}
            </div>
            ${showEnable ? `
                <div class="bell-enable">
                    <span>Get reminders on this device, even in another tab.</span>
                    <button type="button" data-enable>Turn on</button>
                </div>` : ""}
            <div class="bell-list">
                ${items.length === 0
                    ? '<p class="bell-empty">You have no notifications yet.</p>'
                    : items.map((n) => `
                        <button type="button" class="bell-item${n.read ? "" : " unread"} ${escapeHtml(n.kind || "info")}" data-id="${escapeHtml(n.id)}">
                            <strong>${escapeHtml(n.title)}</strong>
                            ${n.body ? `<span>${escapeHtml(n.body)}</span>` : ""}
                            <small>${timeAgo(n.createdAt)}</small>
                        </button>`).join("")}
            </div>
        `;
    }

    function place(button) {
        const box = button.getBoundingClientRect();
        const width = Math.min(360, window.innerWidth - 24);
        panel.style.width = `${width}px`;
        panel.style.top = `${box.bottom + 10}px`;
        panel.style.left = `${Math.max(12, Math.min(box.right - width, window.innerWidth - width - 12))}px`;
    }

    function open(button) {
        place(button);
        panel.hidden = false;
        buttons.forEach((b) => b.setAttribute("aria-expanded", "true"));
    }

    function close() {
        panel.hidden = true;
        buttons.forEach((b) => b.setAttribute("aria-expanded", "false"));
    }

    buttons.forEach((button) => {
        button.addEventListener("click", (event) => {
            event.stopPropagation();
            if (panel.hidden) open(button); else close();
        });
    });

    document.addEventListener("click", (event) => {
        if (!panel.hidden && !panel.contains(event.target)) close();
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") close();
    });

    window.addEventListener("resize", close);

    async function markRead(ids) {
        const changes = {};
        ids.forEach((id) => { changes[`${id}/read`] = true; });
        if (ids.length) await update(ref(db, `notifications/${uid}`), changes).catch(() => {});
    }

    panel.addEventListener("click", async (event) => {

        event.stopPropagation();

        if (event.target.closest("[data-read-all]")) {
            await markRead(unread().map((n) => n.id));
            return;
        }

        if (event.target.closest("[data-enable]")) {
            const result = await enableDeviceNotifications();
            if (result === "denied") alert("Notifications are blocked. You can allow them from your browser's site settings.");
            render();
            return;
        }

        const item = event.target.closest(".bell-item");
        if (!item) return;

        const n = items.find((x) => x.id === item.dataset.id);
        if (!n) return;

        await markRead([n.id]);

        if (n.url) {
            const target = new URL(resolveUrl(n.url));

            if (target.pathname !== location.pathname) {
                window.location.href = target.href;
            } else {
                // Already on that page: let the page jump to the appointment
                close();
                window.dispatchEvent(new CustomEvent("bell:open", { detail: n }));
            }
        }
    });

    onValue(query(ref(db, `notifications/${uid}`), limitToLast(30)), (snapshot) => {

        items = Object.entries(snapshot.val() || {})
            .map(([id, n]) => ({ id, ...n }))
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        // Pop a device notification for anything new since the page opened
        items.forEach((n) => {
            if (seen.has(n.id)) return;
            seen.add(n.id);
            if (!n.read && (n.createdAt || 0) > mountedAt) {
                showDeviceNotification(n.title, n.body, n.url ? resolveUrl(n.url) : "");
            }
        });

        render();

    }, (error) => console.warn("Notifications unavailable:", error));

    render();
}

/* ===== Profile dropdown (Log Out sa loob ng Profile menu) ===== */
(function () {
    var USER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';
    var CHEVRON = '<svg class="pm-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';

    function ensureLabel(el, text) {
        if (!el.textContent.trim()) {
            var s = document.createElement("span");
            s.textContent = text;
            el.appendChild(s);
        }
    }

    function build(logout, profile, isMobile) {
        var menu = document.createElement("div");
        menu.className = "profile-menu" + (isMobile ? " is-mobile" : "");

        var trigger = document.createElement("button");
        trigger.type = "button";
        trigger.className = "profile-menu-trigger";
        trigger.setAttribute("aria-haspopup", "menu");
        trigger.setAttribute("aria-expanded", "false");
        trigger.setAttribute("aria-label", profile ? "Profile menu" : "Account menu");
        trigger.innerHTML = USER_ICON + '<span class="pm-label">' +
            (profile ? "Profile" : "Account") + "</span>" + CHEVRON;

        var dropdown = document.createElement("div");
        dropdown.className = "profile-dropdown";
        dropdown.setAttribute("role", "menu");

        var anchor = logout;
        if (profile && (logout.compareDocumentPosition(profile) & Node.DOCUMENT_POSITION_PRECEDING)) {
            anchor = profile;
        }
        anchor.parentNode.insertBefore(menu, anchor);
        menu.appendChild(trigger);
        menu.appendChild(dropdown);

        if (profile) { ensureLabel(profile, "My Profile"); dropdown.appendChild(profile); }
        ensureLabel(logout, "Log Out");
        logout.classList.add("pm-logout");
        dropdown.appendChild(logout);

        function setOpen(open) {
            menu.classList.toggle("open", open);
            trigger.setAttribute("aria-expanded", String(open));
        }
        trigger.addEventListener("click", function (e) {
            e.stopPropagation();
            setOpen(!menu.classList.contains("open"));
        });
        document.addEventListener("click", function (e) {
            if (!menu.contains(e.target)) setOpen(false);
        });
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape") { setOpen(false); trigger.focus(); }
        });
    }

    function init() {
        var dLogout = document.getElementById("logoutBtn") || document.getElementById("desktopLogoutBtn");
        var dProfile = document.getElementById("deskProfileBtn") ||
            document.querySelector(".desktop-nav .nav-profile-btn");
        if (dLogout) build(dLogout, dProfile, false);

        var mLogout = document.getElementById("mobileLogoutBtn");
        var mProfile = document.getElementById("profileBtn") ||
            document.querySelector('.mobile-header-btns [aria-label="My Profile"]');
        if (mLogout) build(mLogout, mProfile, true);
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
