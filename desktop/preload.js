// Preload for the billing UI window.
//
// The renderer runs with contextIsolation and no Node access (see
// createWindow's webPreferences), so this is the only channel it has into the
// main process. Exactly one capability is exposed: hand a finished bill PDF to
// the embedded WhatsApp Web guest and have it sent.
//
// It lives in the main process rather than the renderer because the send
// drives the guest webContents through the CDP debugger — `DOM.setFileInputFiles`
// is the only way to put a file into WhatsApp's <input type="file"> without
// opening a native file picker, it needs a real path on disk, and neither the
// debugger nor the filesystem is reachable from a sandboxed renderer.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('maestroWhatsApp', {
  /**
   * Send one PDF to one chat. Resolves {ok: true} once WhatsApp has accepted
   * the message, or {ok: false, error} if any step failed — the caller is
   * expected to fall back to the manual attach flow on failure rather than
   * silently dropping the bill.
   */
  send: (payload) => ipcRenderer.invoke('whatsapp:send', payload),
});
