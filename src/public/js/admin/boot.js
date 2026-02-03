/**
 * Admin boot script
 * Initializes the admin interface with includes and routing
 */
import { hydrateIncludes } from "/public/js/include-loader.js";
import { initRouter } from "/public/js/admin/router.js";
import "/public/js/admin/shared-utils.js";
import { adminFetch, getAdminToken } from "/public/js/admin/auth.js";

// Section controllers (optional)
import * as dashboard from "/public/js/admin/sections/dashboard.js";
import * as docUpload from "/public/js/admin/sections/doc-upload.js";
import * as dip from "/public/js/admin/sections/dip.js";
import * as jobs from "/public/js/admin/sections/jobs.js";
import * as chunks from "/public/js/admin/sections/chunks.js";
import * as metrics from "/public/js/admin/sections/metrics.js";
import * as health from "/public/js/admin/sections/health.js";
import * as systems from "/public/js/admin/sections/systems.js";
import * as suggestions from "/public/js/admin/sections/suggestions.js";

const controllers = {
    dashboard,
    docUpload,
    dip,
    jobs,
    chunks,
    metrics,
    health,
    systems,
    suggestions
};

// Global admin state (token retrieved at runtime via PIN auth, not hardcoded)
window.AdminState = {
    currentJob: null,
    currentChunks: [],
    refreshInterval: null,
    get ADMIN_TOKEN() {
        return getAdminToken();
    }
};

// Expose adminFetch globally for pages that use window.adminFetch
window.adminFetch = adminFetch;

(async function main() {
    try {
        // Hydrate all includes
        await hydrateIncludes(document);
        
        // Initialize router
        const router = initRouter();
        
        // Initialize section controllers
        Object.entries(controllers).forEach(([name, mod]) => {
            if (typeof mod.init === "function") {
                try { 
                    mod.init({ router, adminState: window.AdminState }); 
                } catch (err) {
                    console.error(`Failed to initialize ${name} controller:`, err);
                }
            }
        });
        
        // Admin interface initialized successfully - using logger would require server-side context
        // console.log('Admin interface initialized successfully');
        
    } catch (error) {
        console.error('Failed to initialize admin interface:', error);
    }
})();
