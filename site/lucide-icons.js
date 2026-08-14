(() => {
  const iconNodes = {
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>',
    'arrow-up-right': '<path d="M7 7h10v10"></path><path d="M7 17 17 7"></path>',
    box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"></path><path d="m3.3 7 8.7 5 8.7-5"></path><path d="M12 22V12"></path>',
    check: '<path d="m5 12 4 4L19 6"></path>',
    circle: '<circle cx="12" cy="12" r="10"></circle>',
    command: '<path d="M18 3a3 3 0 1 0-3 3v9a3 3 0 1 0 3 3 3 3 0 1 0 3-3 3 3 0 1 0-3-3V6a3 3 0 1 0-3-3Z"></path><path d="M6 3a3 3 0 1 1 3 3v9a3 3 0 1 1-3 3 3 3 0 1 1-3-3 3 3 0 1 1 3-3V6a3 3 0 1 1 3-3Z"></path>',
    container: '<path d="M5 4h14"></path><path d="M5 4v16"></path><path d="M19 4v16"></path><path d="M5 8h14"></path><path d="M5 20h14"></path><path d="M9 4v4"></path><path d="M15 4v4"></path><path d="M9 20v-4"></path><path d="M15 20v-4"></path>',
    download: '<path d="M12 15V3"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path>',
    'file-clock': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"></path><path d="M14 2v6h6"></path><circle cx="12" cy="15" r="3"></circle><path d="M12 13v2l1 1"></path>',
    'folder-kanban': '<path d="M4 20V4"></path><path d="M4 4h16"></path><path d="M20 4v16"></path><path d="M4 20h16"></path><path d="M8 16v-4"></path><path d="M12 16V8"></path><path d="M16 16v-6"></path>',
    key: '<circle cx="7.5" cy="15.5" r="5.5"></circle><path d="m21 2-9.6 9.6"></path><path d="m15.5 7.5 3 3"></path><path d="m18.5 4.5 1 1"></path>',
    'key-round': '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V20a2 2 0 0 0 2 2h1.172a2 2 0 0 0 1.414-.586l.92-.92"></path><path d="m6.8 16.8 3.4-3.4"></path><circle cx="16" cy="8" r="6"></circle><path d="m21 3-3 3"></path><path d="m18 6 3 3"></path>',
    languages: '<path d="m5 8 6 6"></path><path d="m4 14 6-6 2-3"></path><path d="M2 5h12"></path><path d="M7 2h1"></path><path d="m22 22-5-10-5 10"></path><path d="M14 18h6"></path>',
    'link-2': '<path d="M9 17H7A5 5 0 0 1 7 7h2"></path><path d="M15 7h2a5 5 0 0 1 0 10h-2"></path><line x1="8" x2="16" y1="12" y2="12"></line>',
    'lock-keyhole': '<circle cx="12" cy="16" r="1"></circle><rect width="18" height="12" x="3" y="10" rx="2"></rect><path d="M7 10V7a5 5 0 0 1 10 0v3"></path>',
    mouse: '<rect width="14" height="20" x="5" y="2" rx="7"></rect><path d="M12 6v4"></path>',
    package: '<path d="m16.5 9.4-9-5.19"></path><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"></path><path d="m3.27 6.96 8.73 5.05 8.73-5.05"></path><path d="M12 22.08V12"></path>',
    'package-open': '<path d="m16.5 9.4-9-5.19"></path><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"></path><path d="m3.27 6.96 8.73 5.05 8.73-5.05"></path><path d="M12 22.08V12"></path>',
    radio: '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"></path><path d="M7.8 16.2a6 6 0 0 1 0-8.4"></path><circle cx="12" cy="12" r="2"></circle><path d="M16.2 7.8a6 6 0 0 1 0 8.4"></path><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"></path>',
    route: '<circle cx="6" cy="19" r="3"></circle><path d="M9 19h6a3 3 0 0 0 3-3V8"></path><circle cx="18" cy="5" r="3"></circle>',
    'scan-line': '<path d="M3 7V5a2 2 0 0 1 2-2h2"></path><path d="M17 3h2a2 2 0 0 1 2 2v2"></path><path d="M21 17v2a2 2 0 0 1-2 2h-2"></path><path d="M7 21H5a2 2 0 0 1-2-2v-2"></path><path d="M7 12h10"></path>',
    'scan-search': '<path d="M3 7V5a2 2 0 0 1 2-2h2"></path><path d="M17 3h2a2 2 0 0 1 2 2v2"></path><path d="M21 17v2a2 2 0 0 1-2 2h-2"></path><path d="M7 21H5a2 2 0 0 1-2-2v-2"></path><circle cx="11" cy="11" r="3"></circle><path d="m15 15 2 2"></path>',
    server: '<rect width="20" height="8" x="2" y="2" rx="2" ry="2"></rect><rect width="20" height="8" x="2" y="14" rx="2" ry="2"></rect><line x1="6" x2="6.01" y1="6" y2="6"></line><line x1="6" x2="6.01" y1="18" y2="18"></line>',
    'settings-2': '<path d="M20 7h-9"></path><path d="M14 17H5"></path><circle cx="17" cy="17" r="3"></circle><circle cx="7" cy="7" r="3"></circle>',
    shield: '<path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3v8Z"></path>',
    'shield-check': '<path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3v8Z"></path><path d="m9 12 2 2 4-4"></path>',
    'square-code': '<rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="m9 9-3 3 3 3"></path><path d="m15 9 3 3-3 3"></path>',
    terminal: '<polyline points="4 17 10 11 4 5"></polyline><line x1="12" x2="20" y1="19" y2="19"></line>',
    timer: '<line x1="10" x2="14" y1="2" y2="2"></line><line x1="12" x2="12" y1="14" y2="10"></line><circle cx="12" cy="14" r="8"></circle><path d="M17 4 19 6"></path>',
    'triangle-alert': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path>',
    workflow: '<rect width="8" height="8" x="3" y="3" rx="2"></rect><path d="M7 11v2a2 2 0 0 0 2 2h2"></path><rect width="8" height="8" x="13" y="13" rx="2"></rect><path d="M13 7h2a2 2 0 0 1 2 2v4"></path>'
  };

  function renderLucideIcons() {
    document.querySelectorAll('[data-lucide]').forEach((element) => {
      const name = element.getAttribute('data-lucide');
      const nodes = name ? iconNodes[name] : null;
      if (!nodes || element.tagName.toLowerCase() === 'svg') return;

      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('aria-hidden', element.getAttribute('aria-hidden') || 'true');
      icon.setAttribute('focusable', 'false');
      icon.setAttribute('class', `lucide lucide-${name}`);
      icon.innerHTML = nodes;
      element.replaceWith(icon);
    });
  }

  window.renderLucideIcons = renderLucideIcons;
  renderLucideIcons();
})();
