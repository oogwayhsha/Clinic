// ==========================================
// SERVICES + BOOKING REASONS
// Patients first pick a service, then one of the clinic's reasons
// for that service (no free text).
// The admin edits the reasons (bookingReasons/{id} = { name, active, order, service });
// until the admin saves one, this default list is used.
// The services themselves are fixed: they match the dashboard cards.
// ==========================================

export const REASON_MAX = 100;

export const SERVICES = [
    {
        id: "consultation",
        name: "Medical Consultation",
        blurb: "Check-ups, illness, fever, minor injuries and follow-up visits."
    },
    {
        id: "dental",
        name: "Dental Consultation",
        blurb: "Dental check-ups, cleaning and basic oral care."
    },
    {
        id: "certificate",
        name: "Medical Certificate",
        blurb: "Medical certificates and clearances: OJT, tours, new enrollees."
    }
];

export const SERVICE_IDS = SERVICES.map((s) => s.id);

export const serviceName = (id) => SERVICES.find((s) => s.id === id)?.name || "";

export const DEFAULT_REASONS = [
    { service: "consultation", name: "General Medical Consultation" },
    { service: "consultation", name: "Headache / Fever / Flu Symptoms" },
    { service: "consultation", name: "Minor Injury / First Aid" },
    { service: "consultation", name: "Follow-up Checkup" },

    { service: "dental", name: "Dental Check-up" },
    { service: "dental", name: "Toothache / Tooth Pain" },
    { service: "dental", name: "Teeth Cleaning" },
    { service: "dental", name: "Dental Follow-up" },

    { service: "certificate", name: "Medical Certificate Request" },
    { service: "certificate", name: "OJT Medical Clearance" },
    { service: "certificate", name: "Out-of-Campus Tour Medical Clearance" },
    { service: "certificate", name: "New Enrollee Medical Assessment" }
];

// Reasons saved before services existed have no "service": tell it from the wording
export function guessService(name) {
    const text = String(name || "").toLowerCase();
    if (/dental|dentist|tooth|teeth|oral|gum/.test(text)) return "dental";
    if (/certificate|clearance|assessment|fit to/.test(text)) return "certificate";
    return "consultation";
}

const serviceRank = (id) => {
    const index = SERVICE_IDS.indexOf(id);
    return index < 0 ? SERVICE_IDS.length : index;
};

const byServiceThenOrder = (a, b) =>
    serviceRank(a.service) - serviceRank(b.service) ||
    (a.order ?? 999) - (b.order ?? 999) ||
    String(a.name).localeCompare(String(b.name));

// Every saved reason, including switched-off ones (admin list)
export function allReasons(data) {
    return Object.entries(data || {})
        .map(([id, value]) => ({
            id,
            ...value,
            service: SERVICE_IDS.includes(value?.service) ? value.service : guessService(value?.name)
        }))
        .filter((r) => r.name)
        .sort(byServiceThenOrder);
}

// What patients can choose from
export function normalizeReasons(data) {

    if (!data) {
        return DEFAULT_REASONS.map((r, index) => ({ id: `default-${index}`, ...r, active: true, order: index }));
    }

    return allReasons(data).filter((r) => r.active !== false);
}
