/**
 * Admin boot script
 * Initializes the admin interface with includes and routing
 */
import { hydrateIncludes } from "/public/js/include-loader.js";
import { initRouter } from "/public/js/admin/router.js";
import "/public/js/admin/shared-utils.js";

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

// Global admin state
window.AdminState = {
    currentJob: null,
    currentChunks: [],
    refreshInterval: null,
    ADMIN_TOKEN: 'd0bf5af4f2e469d29e051e39e9569a76a283ad4d5c68935e38321320137b05d0'
};

// Helper function for authenticated requests
window.adminFetch = async function(url, options = {}) {
    const defaultHeaders = {
        'x-admin-token': window.AdminState.ADMIN_TOKEN,
        // NOTE: we'll only add Content-Type for non-FormData bodies
    };

    const isFormData = options && options.body && (options.body instanceof FormData);
    const headers = isFormData
        ? { ...defaultHeaders, ...(options.headers || {}) }            // DO NOT set Content-Type
        : { ...defaultHeaders, 'Content-Type': 'application/json', ...(options.headers || {}) };

    const finalOptions = { ...options, headers };
    return fetch(url, finalOptions);
};

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
