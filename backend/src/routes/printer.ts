import { FastifyInstance } from 'fastify';
import { execFile } from 'child_process';

interface WindowsPrinter {
  Name: string;
  WorkOffline: boolean;
}

export interface PrinterStatus {
  available: boolean;
  offline: boolean;
  /** The configured printer name we looked for (thermal_printer_name setting). */
  printerName: string;
  /** The actual Windows printer name that matched, if any. */
  matchedName: string | null;
}

/** Compare printer names loosely: "RP-3160" matches "RP3160 Printer" etc. */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function listWindowsPrinters(): Promise<WindowsPrinter[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Printer | Select-Object Name,WorkOffline | ConvertTo-Json -Compress',
      ],
      { timeout: 10_000, windowsHide: true },
      (err, stdout) => {
        if (err) return reject(err);
        // A throw here would escape the promise (execFile callbacks are not
        // executor code) and leave the request hanging — always settle.
        try {
          const trimmed = stdout.trim();
          if (!trimmed) return resolve([]);
          // ConvertTo-Json emits a bare object (not an array) when there is
          // exactly one printer installed.
          const parsed = JSON.parse(trimmed) as WindowsPrinter | WindowsPrinter[];
          resolve(Array.isArray(parsed) ? parsed : [parsed]);
        } catch (parseErr) {
          reject(parseErr);
        }
      },
    );
  });
}

export async function printerRoutes(fastify: FastifyInstance) {
  // Spawning PowerShell takes ~1s; the frontend polls every 15s, so the TTL
  // must exceed that interval or the cache never serves the poller and every
  // poll spawns a fresh process.
  let cached: { at: number; data: PrinterStatus } | null = null;
  const CACHE_MS = 30_000;

  // GET /api/v1/printer/status — is the configured thermal printer installed?
  fastify.get('/status', async (_request, reply) => {
    if (cached && Date.now() - cached.at < CACHE_MS) {
      return reply.send({ success: true, data: cached.data });
    }

    const setting = await fastify.prisma.setting.findUnique({
      where: { key: 'thermal_printer_name' },
    });
    const printerName = setting?.value?.trim() || 'RP-3160';
    const wanted = normalizeName(printerName);

    let printers: WindowsPrinter[] = [];
    try {
      printers = await listWindowsPrinters();
    } catch (err) {
      fastify.log.warn({ err }, 'Printer availability check failed');
      // Report "not available" rather than erroring — the badge in the UI
      // should degrade gracefully when the check itself can't run.
    }

    const match = printers.find((p) => {
      const n = normalizeName(p.Name ?? '');
      return n.includes(wanted) || wanted.includes(n);
    });

    const data: PrinterStatus = {
      available: !!match,
      offline: !!match?.WorkOffline,
      printerName,
      matchedName: match?.Name ?? null,
    };
    cached = { at: Date.now(), data };
    return reply.send({ success: true, data });
  });
}
