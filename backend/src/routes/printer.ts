import { FastifyInstance } from 'fastify';
import { execFile } from 'child_process';

interface WindowsPrinter {
  Name: string;
  PrinterStatus: number;
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

// MSFT_Printer.PrinterStatus (what Get-Printer reads) is a NUMERIC bitmask,
// not the friendly name Format-Table shows on screen — ConvertTo-Json
// serializes the raw number. Comparing against string names like 'Offline'
// (an earlier version of this fix did) silently never matches, which is why
// that fix didn't actually change anything — confirmed live: this machine's
// RP3160 printer reports PrinterStatus 4096 (NotAvailable) while Format-Table
// displays it as "NotAvailable". Values below are the documented flag bits:
//   Normal=0 Paused=1 Error=2 PendingDeletion=4 PaperJam=8 PaperOut=16
//   ManualFeed=32 PaperProblem=64 Offline=128 IOActive=256 Busy=512
//   Printing=1024 OutputBinFull=2048 NotAvailable=4096 Waiting=8192
//   Processing=16384 Initializing=32768 WarmingUp=65536 TonerLow=131072
//   NoToner=262144 PagePunt=524288 UserInterventionRequired=1048576
//   OutOfMemory=2097152 DoorOpen=4194304 ServerUnknown=8388608 PowerSave=16777216
const OFFLINE_STATUS_FLAGS =
  2 /* Error */ |
  128 /* Offline */ |
  4096 /* NotAvailable */ |
  4194304 /* DoorOpen */ |
  8388608 /* ServerUnknown */;

function listWindowsPrinters(): Promise<WindowsPrinter[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        // Get-Printer (not Win32_Printer/WorkOffline) — WorkOffline is a
        // manual "Use Printer Offline" toggle that never flips just because a
        // USB thermal printer is unplugged or switched off, so it always read
        // false and the badge showed "ready" permanently. Get-Printer's
        // PrinterStatus is computed live by querying the port monitor, so it
        // actually reflects whether the device answers right now.
        'Get-Printer | Select-Object Name,PrinterStatus | ConvertTo-Json -Compress',
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
      offline: !!match && (match.PrinterStatus & OFFLINE_STATUS_FLAGS) !== 0,
      printerName,
      matchedName: match?.Name ?? null,
    };
    cached = { at: Date.now(), data };
    return reply.send({ success: true, data });
  });
}
