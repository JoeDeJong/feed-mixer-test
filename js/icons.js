// Small line-icon set (24×24, drawn with currentColor) so the app needs no
// icon font or network access.

const PATHS = {
  load: '<path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.5"/><circle cx="17" cy="17.5" r="1.5"/>',
  rations: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M9 10h6M9 14h6M9 18h4"/>',
  ingredients: '<path d="M12 21V9"/><path d="M12 9c0-2.6 1.9-4.5 4.5-4.5 0 2.6-1.9 4.5-4.5 4.5z"/><path d="M12 9c0-2.6-1.9-4.5-4.5-4.5 0 2.6 1.9 4.5 4.5 4.5z"/><path d="M12 15c0-2.6 1.9-4.5 4.5-4.5 0 2.6-1.9 4.5-4.5 4.5z"/><path d="M12 15c0-2.6-1.9-4.5-4.5-4.5 0 2.6 1.9 4.5 4.5 4.5z"/>',
  pens: '<path d="M5 20V7l2-2 2 2v13M15 20V7l2-2 2 2v13M9 10h6M9 16h6"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  dashboard: '<path d="M4 20h16"/><rect x="5.5" y="11" width="3" height="6" rx="1"/><rect x="10.5" y="6" width="3" height="11" rx="1"/><rect x="15.5" y="13" width="3" height="4" rx="1"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.7 3 2.5 3.5 5.2"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  skip: '<path d="M6 6l8 6-8 6z"/><path d="M18 6v12"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  key: '<circle cx="8" cy="14" r="4"/><path d="M11 11l8-8M16 6l2 2M14 8l2 2"/>',
  alert: '<path d="M12 3.5l9.5 17h-19z"/><path d="M12 10v4.5M12 17.5v.5"/>',
  bucket: '<path d="M4 8h16l-2 12H6z"/><path d="M8 8a4 4 0 0 1 8 0"/>',
  backspace: '<path d="M8 5h12v14H8l-6-7z"/><path d="M12 9l5 6M17 9l-5 6"/>',
  mixer: '<path d="M3 15h15l2-6H6z"/><circle cx="8" cy="18" r="2"/><circle cx="15" cy="18" r="2"/><path d="M9 9V6M13 9V5M17 9V7"/>',
};

export function icon(name, size = 20) {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? ''}</svg>`;
}
