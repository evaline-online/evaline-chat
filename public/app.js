// EvaLine Chat browser UI.
// Built separately; this host only serves static assets for the HTTP API.
window.addEventListener('DOMContentLoaded', () => {
  const rooms = document.getElementById('rooms');
  if (rooms) {
    rooms.setAttribute('aria-busy', 'false');
  }
  console.log('[evaline-chat] UI shell loaded');
});