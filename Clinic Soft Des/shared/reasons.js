// ==========================================
// BOOKING REASONS
// Patients pick one of these instead of typing a reason.
// The admin edits the list (bookingReasons/{id} = { name, active, order });
// until the admin saves one, this default list is used.
// ==========================================

export const REASON_MAX = 100;

export const DEFAULT_REASONS = [
    "General Medical Consultation",
    "Headache / Fever / Flu Symptoms",
    "Minor Injury / First Aid",
    "Follow-up Checkup",
    "OJT Medical Clearance",
    "Medical Certificate Request",
    "Out-of-Campus Tour Medical Clearance",
    "New Enrollee Medical Assessment"
];

const byOrder = (a, b) =>
    (a.order ?? 999) - (b.order ?? 999) || String(a.name).localeCompare(String(b.name));

// Every saved reason, including switched-off ones (admin list)
export function allReasons(data) {
    return Object.entries(data || {})
        .map(([id, value]) => ({ id, ...value }))
        .filter((r) => r.name)
        .sort(byOrder);
}

// What patients can choose from
export function normalizeReasons(data) {

    if (!data) {
        return DEFAULT_REASONS.map((name, index) => ({ id: `default-${index}`, name, active: true, order: index }));
    }

    return allReasons(data).filter((r) => r.active !== false);
}
