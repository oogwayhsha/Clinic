// ==========================================
// PROFILE PHOTOS
// Stored as small JPEGs in the Realtime Database (avatars/{uid}),
// because Firebase Storage needs the paid Blaze plan. Each photo is
// cropped to a square and shrunk to 256 px (about 20-40 KB) first.
// ==========================================
import { db } from "../firebase/firebase.js";

import {
    ref,
    get,
    set,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

import { escapeHtml } from "./clinic.js";

const SIZE = 256;
const MAX_UPLOAD = 15 * 1024 * 1024;   // largest original file accepted

// Only our own JPEG data URLs are ever put into the page
const isPhoto = (value) =>
    typeof value === "string" && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value);

export function initialsOf(name) {
    return String(name || "")
        .replace(/^Dr\.?\s+/i, "")
        .split(/\s+/).filter(Boolean).slice(0, 2)
        .map((part) => part[0].toUpperCase()).join("") || "?";
}

// Inner HTML for an avatar circle: the photo, or the person's initials
export function avatarInner(photo, name) {
    return isPhoto(photo)
        ? `<img src="${photo}" alt="${escapeHtml(name || "Profile photo")}">`
        : escapeHtml(initialsOf(name));
}

export function showAvatar(el, photo, name) {
    if (!el) return;
    el.innerHTML = avatarInner(photo, name);
    el.classList.toggle("has-photo", isPhoto(photo));
}


/* =========================================
   LOAD / SAVE
========================================= */

export async function loadAvatar(uid) {
    try {
        const snap = await get(ref(db, `avatars/${uid}/photo`));
        return isPhoto(snap.val()) ? snap.val() : null;
    } catch (error) {
        console.warn("Could not load photo:", error);
        return null;
    }
}

export async function loadAvatars(uids) {
    const entries = await Promise.all([...new Set(uids)].map(async (uid) => [uid, await loadAvatar(uid)]));
    return Object.fromEntries(entries.filter(([, photo]) => photo));
}

export async function saveAvatar(uid, photo) {
    await set(ref(db, `avatars/${uid}`), photo ? { photo, updatedAt: serverTimestamp() } : null);

    // The header's account menu listens for this (shared/notify.js)
    window.dispatchEvent(new CustomEvent("avatarchange", { detail: { photo } }));
}


/* =========================================
   PICK + SHRINK
========================================= */

// Opens the file picker; resolves with the chosen file (or null)
export function pickImage() {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/jpeg,image/png,image/webp";
        input.addEventListener("change", () => resolve(input.files[0] || null), { once: true });
        input.click();
    });
}

function loadImage(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("unreadable")); };
        img.src = url;
    });
}

// Center-cropped square JPEG data URL. Throws "not-image", "too-big" or "unreadable".
export async function shrinkImage(file) {

    if (!file.type.startsWith("image/")) throw new Error("not-image");
    if (file.size > MAX_UPLOAD) throw new Error("too-big");

    const img = await loadImage(file);
    const side = Math.min(img.naturalWidth, img.naturalHeight);

    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;

    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";   // transparent PNGs get a white background
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(img,
        (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side,
        0, 0, SIZE, SIZE);

    return canvas.toDataURL("image/jpeg", 0.82);
}

export function photoErrorMessage(error) {
    return {
        "not-image": "Please choose a photo (JPG, PNG or WebP).",
        "too-big": "That photo is too large. Please choose one under 15 MB.",
        "unreadable": "That photo couldn't be read. Try a JPG or PNG (iPhone HEIC photos aren't supported)."
    }[error?.message] || "Couldn't save the photo. Please try again.";
}
