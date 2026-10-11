export function notify(message: string, type: 'success' | 'error' = 'error') {
  window.dispatchEvent(new CustomEvent('edu-toast', { detail: { message, type, id: crypto.randomUUID() } }));
}
