/**
 * Mobile Hamburger Menu Component
 * Grouped slide-out navigation for all mobile pages
 *
 * Usage: Add <script src="/public/js/mobile-hamburger.js"></script> before </body>
 */

(function() {
    'use strict';

    if (window.__hamburgerMenuInitialized) return;
    window.__hamburgerMenuInitialized = true;

    // Build maintenance URL based on hostname
    function getMaintenanceUrl() {
        const hostname = window.location.hostname;
        const protocol = window.location.protocol;

        if (hostname === 'chat.catamaranos.com') {
            return 'https://admin.catamaranos.com';
        } else if (hostname === 'boatos-main.onrender.com') {
            return 'https://boatos-maintenance.onrender.com';
        } else if (hostname === 'localhost') {
            return 'http://localhost:3001';
        } else if (hostname.match(/^\d+\.\d+\.\d+\.\d+$/)) {
            return `${protocol}//${hostname}:3001`;
        }
        return 'http://localhost:3001';
    }

    // Menu structure
    const MENU_ITEMS = [
        { type: 'item', label: 'Home', icon: '\u{1F3E0}', href: '/public/unified-mobile.html', match: ['unified-mobile'] },

        { type: 'group', label: 'BOAT STATUS' },
        { type: 'item', label: 'Current Status', href: '/public/boat-now.html', match: ['boat-now'] },
        { type: 'item', label: 'Power System', href: '/public/victron-mobile.html', match: ['victron-mobile'] },
        { type: 'item', label: 'AIS Tracking', href: '/public/ais.html', match: ['ais.html'] },
        { type: 'item', label: 'Position Monitor', href: '/public/position-monitor.html', match: ['position-monitor'] },

        { type: 'group', label: 'NAVIGATION & TRIPS' },
        { type: 'item', label: 'Anchor Watch', href: '/public/anchor-watch-admin.html', match: ['anchor-watch'] },
        { type: 'item', label: 'Anchorages', href: '/public/anchorages.html', match: ['anchorages'] },
        { type: 'item', label: 'Trip Log', href: '/public/trips.html', match: ['trips.html'] },
        { type: 'item', label: 'Season Recap', href: '/public/season-recap.html', match: ['season-recap'] },

        { type: 'group', label: 'WEATHER' },
        { type: 'item', label: 'Weather Areas', href: '/public/weather-areas.html', match: ['weather-area'] },
        { type: 'item', label: 'Add Location', href: '/public/weather-area-add.html', match: ['weather-area-add'] },

        { type: 'group', label: 'BOAT MANAGEMENT' },
        { type: 'item', label: 'Supplies', href: '/public/supplies.html', match: ['supplies.html'] },
        { type: 'item', label: 'Maintenance', href: '__MAINTENANCE__/app-mobile.html', match: ['maintenance-review', 'maintenance-tasks'] },
        { type: 'item', label: 'Tasks', href: '__MAINTENANCE__/tasks-mobile.html', match: ['tasks-mobile'] },

        { type: 'divider' },
        { type: 'item', label: 'Chat', icon: '\u{1F4AC}', href: '/public/index-mobile.html', match: ['index-mobile', 'chat-mobile'] },
    ];

    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* Hamburger Button */
            .hamburger-btn {
                position: fixed;
                top: 0;
                left: 0;
                z-index: 200;
                padding: 14px 16px;
                padding-top: calc(14px + env(safe-area-inset-top));
                background: none;
                border: none;
                font-size: 22px;
                cursor: pointer;
                color: var(--text-primary, #000);
                line-height: 1;
                -webkit-tap-highlight-color: transparent;
            }

            .hamburger-btn:active {
                opacity: 0.5;
            }

            /* Backdrop */
            .hamburger-backdrop {
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.4);
                z-index: 250;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.3s ease;
                -webkit-tap-highlight-color: transparent;
            }

            .hamburger-backdrop.visible {
                opacity: 1;
                pointer-events: auto;
            }

            /* Slide-out Menu */
            .hamburger-menu {
                position: fixed;
                top: 0;
                left: 0;
                bottom: 0;
                width: 270px;
                background: #FFFFFF;
                z-index: 300;
                transform: translateX(-100%);
                transition: transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1);
                overflow-y: auto;
                -webkit-overflow-scrolling: touch;
                padding-top: calc(20px + env(safe-area-inset-top));
                padding-bottom: calc(20px + env(safe-area-inset-bottom));
            }

            .hamburger-menu.open {
                transform: translateX(0);
            }

            /* Menu Items */
            .hmenu-item {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px 20px;
                text-decoration: none;
                color: var(--text-primary, #000);
                font-size: 15px;
                font-weight: 400;
                transition: background 0.15s;
                -webkit-tap-highlight-color: transparent;
            }

            .hmenu-item:active {
                background: rgba(0, 0, 0, 0.05);
            }

            .hmenu-item.active {
                color: var(--primary-color, #007AFF);
                font-weight: 600;
            }

            .hmenu-item-icon {
                font-size: 20px;
                width: 28px;
                text-align: center;
                flex-shrink: 0;
            }

            /* Group Labels */
            .hmenu-group {
                padding: 20px 20px 6px 20px;
                font-size: 11px;
                font-weight: 600;
                color: var(--text-secondary, #8E8E93);
                letter-spacing: 0.8px;
                text-transform: uppercase;
            }

            .hmenu-group:first-child {
                padding-top: 10px;
            }

            /* Divider */
            .hmenu-divider {
                height: 1px;
                background: var(--border-color, #C6C6C8);
                margin: 8px 20px;
            }

            /* Ensure body has top padding so hamburger doesn't overlap content */
            body {
                padding-top: calc(48px + env(safe-area-inset-top)) !important;
            }
        `;
        document.head.appendChild(style);
    }

    function injectMenu() {
        const currentPath = window.location.pathname;
        const maintenanceUrl = getMaintenanceUrl();

        // Build menu HTML
        let menuHTML = '';
        MENU_ITEMS.forEach(function(item) {
            if (item.type === 'group') {
                menuHTML += '<div class="hmenu-group">' + item.label + '</div>';
            } else if (item.type === 'divider') {
                menuHTML += '<div class="hmenu-divider"></div>';
            } else if (item.type === 'item') {
                var href = item.href.replace('__MAINTENANCE__', maintenanceUrl);
                var isActive = item.match && item.match.some(function(m) { return currentPath.includes(m); });
                var activeClass = isActive ? ' active' : '';
                var icon = item.icon ? '<span class="hmenu-item-icon">' + item.icon + '</span>' : '<span class="hmenu-item-icon"></span>';
                menuHTML += '<a href="' + href + '" class="hmenu-item' + activeClass + '">' + icon + item.label + '</a>';
            }
        });

        // Create backdrop
        var backdrop = document.createElement('div');
        backdrop.className = 'hamburger-backdrop';
        backdrop.addEventListener('click', closeMenu);

        // Create menu
        var menu = document.createElement('div');
        menu.className = 'hamburger-menu';
        menu.innerHTML = menuHTML;

        // Create hamburger button
        var btn = document.createElement('button');
        btn.className = 'hamburger-btn';
        btn.setAttribute('aria-label', 'Open menu');
        btn.innerHTML = '&#9776;';
        btn.addEventListener('click', toggleMenu);

        document.body.appendChild(backdrop);
        document.body.appendChild(menu);
        document.body.appendChild(btn);
    }

    function toggleMenu() {
        var menu = document.querySelector('.hamburger-menu');
        var backdrop = document.querySelector('.hamburger-backdrop');
        if (menu.classList.contains('open')) {
            closeMenu();
        } else {
            menu.classList.add('open');
            backdrop.classList.add('visible');
        }
    }

    function closeMenu() {
        var menu = document.querySelector('.hamburger-menu');
        var backdrop = document.querySelector('.hamburger-backdrop');
        menu.classList.remove('open');
        backdrop.classList.remove('visible');
    }

    // Close on Escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') closeMenu();
    });

    function init() {
        injectStyles();
        injectMenu();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
