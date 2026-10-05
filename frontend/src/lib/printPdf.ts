/**
 * Maestro Billing — Reliable PDF Print Helper
 *
 * Triggers printing of a PDF Blob or Uint8Array using an offscreen iframe.
 *
 * In Chromium / Electron on Windows 11:
 * 1. `display: none` prevents Chromium from building the render tree and running
 *    the PDF plugin, causing silent print failures or blank output.
 * 2. Positioning the iframe off-screen (`position: fixed; top: -9999px; left: -9999px; ...`)
 *    keeps it in the render tree so the PDF plugin parses and formats the document.
 * 3. Adding a small execution delay before invoking `contentWindow.print()` guarantees
 *    the PDF renderer has prepared the document for the OS print dialog.
 */

export function printPdfBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.top = '-9999px';
  iframe.style.left = '-9999px';
  iframe.style.width = '1000px';
  iframe.style.height = '1000px';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  iframe.style.border = '0';
  iframe.src = url;
  document.body.appendChild(iframe);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (iframe.parentNode) document.body.removeChild(iframe);
    URL.revokeObjectURL(url);
  };

  iframe.onload = () => {
    iframe.contentWindow?.addEventListener('afterprint', cleanup);
    // Give Chromium a brief slice to initialize PDFium rendering context
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (err) {
        console.error('Failed to invoke print dialog:', err);
      }
    }, 150);
  };

  // Fallback cleanup in case afterprint does not fire
  setTimeout(cleanup, 60_000);
}

export function printPdfBytes(bytes: Uint8Array): void {
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
    type: 'application/pdf',
  });
  printPdfBlob(blob);
}
