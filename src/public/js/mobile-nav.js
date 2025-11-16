/**
 * Mobile Navigation Component - Main App
 * Enterprise-standard shared navigation for all main app mobile pages
 *
 * Usage: Add <script src="/js/mobile-nav.js"></script> before </body>
 */

(function() {
    'use strict';

    // Inject CSS
    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            :root {
                --primary-color: #007AFF;
                --text-secondary: #8E8E93;
                --border-color: #C6C6C8;
                --safe-area-bottom: env(safe-area-inset-bottom);
            }

            /* Ensure body has bottom padding for nav */
            body {
                padding-bottom: calc(70px + var(--safe-area-bottom)) !important;
            }

            /* Bottom Navigation */
            .mobile-bottom-nav {
                position: fixed;
                bottom: 0;
                left: 0;
                right: 0;
                background: rgba(255, 255, 255, 0.8);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                border-top: 0.5px solid var(--border-color);
                padding-bottom: var(--safe-area-bottom);
                z-index: 100;
            }

            .mobile-nav-items {
                display: flex;
                justify-content: space-around;
                padding: 8px 0;
            }

            .mobile-nav-item {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 4px;
                padding: 6px 16px;
                text-decoration: none;
                color: var(--text-secondary);
                transition: all 0.2s;
                flex: 1;
                max-width: 80px;
            }

            .mobile-nav-item.active {
                color: var(--primary-color);
            }

            .mobile-nav-icon {
                font-size: 24px;
                transition: transform 0.2s;
            }

            .mobile-nav-item:active .mobile-nav-icon {
                transform: scale(0.9);
            }

            .mobile-nav-label {
                font-size: 10px;
                font-weight: 500;
                letter-spacing: 0.2px;
            }
        `;
        document.head.appendChild(style);
    }

    // Inject HTML
    function injectNav() {
        const nav = document.createElement('nav');
        nav.className = 'mobile-bottom-nav';
        nav.innerHTML = `
            <div class="mobile-nav-items">
                <a href="/public/unified-mobile.html" class="mobile-nav-item" data-page="home">
                    <div class="mobile-nav-icon">🏠</div>
                    <div class="mobile-nav-label">Home</div>
                </a>
                <a href="/public/anchor-watch-admin.html" class="mobile-nav-item" data-page="anchor">
                    <div class="mobile-nav-icon">⚓</div>
                    <div class="mobile-nav-label">Anchor</div>
                </a>
                <a href="#" id="mobileNavMaintenance" class="mobile-nav-item" data-page="maintenance">
                    <div class="mobile-nav-icon">🔧</div>
                    <div class="mobile-nav-label">Maintenance</div>
                </a>
                <a href="/public/index-mobile.html" class="mobile-nav-item" data-page="chat">
                    <div class="mobile-nav-icon">💬</div>
                    <div class="mobile-nav-label">Chat</div>
                </a>
            </div>
        `;
        document.body.appendChild(nav);
    }

    // Setup cross-service link (Maintenance goes to port 3001)
    function setupLinks() {
        const hostname = window.location.hostname;
        const protocol = window.location.protocol;
        let maintenanceUrl;

        // Production domain
        if (hostname === 'chat.catamaranos.com') {
            maintenanceUrl = 'https://admin.catamaranos.com';
        }
        // Render production
        else if (hostname === 'boatos-main.onrender.com') {
            maintenanceUrl = 'https://boatos-maintenance.onrender.com';
        }
        // Localhost
        else if (hostname === 'localhost') {
            maintenanceUrl = 'http://localhost:3001';
        }
        // Local IP (e.g., 192.168.20.106)
        else if (hostname.match(/^\d+\.\d+\.\d+\.\d+$/)) {
            maintenanceUrl = `${protocol}//${hostname}:3001`;
        }
        // Fallback
        else {
            maintenanceUrl = 'http://localhost:3001';
        }

        document.getElementById('mobileNavMaintenance').href = `${maintenanceUrl}/app-mobile.html`;
    }

    // Detect and highlight active page
    function setActivePage() {
        const currentPath = window.location.pathname;
        const navItems = document.querySelectorAll('.mobile-nav-item');

        // Remove all active classes first
        navItems.forEach(item => item.classList.remove('active'));

        // Determine which page is active based on current path
        if (currentPath.includes('unified-mobile.html') || currentPath === '/' || currentPath === '/public/') {
            document.querySelector('[data-page="home"]')?.classList.add('active');
        } else if (currentPath.includes('anchor-watch')) {
            document.querySelector('[data-page="anchor"]')?.classList.add('active');
        } else if (currentPath.includes('index-mobile.html')) {
            document.querySelector('[data-page="chat"]')?.classList.add('active');
        }
    }

    // Initialize on DOM load
    function init() {
        injectStyles();
        injectNav();
        setupLinks();
        setActivePage();
    }

    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
