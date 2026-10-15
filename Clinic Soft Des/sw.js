// ==========================================
// SERVICE WORKER: shows appointment notifications on phones and
// opens the right page when one is tapped.
// (Lives at the site root so it covers every page.)
// ==========================================

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("notificationclick", (event) => {

    event.notification.close();

    const url = event.notification.data?.url || self.registration.scope;

    event.waitUntil((async () => {

        const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

        // Reuse an open tab of the site if there is one
        for (const client of windows) {
            if (client.url.startsWith(self.registration.scope) && "focus" in client) {
                await client.focus();
                if ("navigate" in client) return client.navigate(url);
                return;
            }
        }

        return self.clients.openWindow(url);
    })());
});
