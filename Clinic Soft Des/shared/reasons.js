
export const DEFAULT_REASONS = [
    "General Medical Consultation",
    "Headache / Fever / Flu Symptoms",
    "Minor Injury / First Aid",
    "Follow-up Checkup",
    "OJT Medical Clearance",
    "Medical Certificate Request",
    "Out-of-Campus Tour Medical Clearance",
    "New Enrollee Medical Assessment",
    "Other"
];

export function normalizeReasons(data) {
    if (!data) {
        return DEFAULT_REASONS.map((name, index) => ({
            id: `default-${index}`,
            name,
            active: true
        }));
    }

    return Object.entries(data)
        .map(([id, value]) => ({ id, ...value }))
        .filter(r => r.name && r.active !== false)
        .sort((a, b) =>
            (a.order ?? 999) - (b.order ?? 999) ||
            a.name.localeCompare(b.name)
        );
}
