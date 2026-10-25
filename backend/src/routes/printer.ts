import { FastifyInstance } from 'fastify';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { requireAppHeader } from '../middleware/requireAppHeader';

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

// Sends bytes to a Windows printer with the spooler's "RAW" datatype, so the
// driver passes them through untouched instead of trying to render them.
//
// Done through PowerShell + a P/Invoke into winspool.drv rather than a native
// npm module on purpose: this project's packaging is fragile around native and
// hoisted dependencies (see PROJECT_HISTORY §3), and printer.ts already shells
// out to PowerShell for the status check, so this adds no new moving parts.
//
// The script and payload go to temp FILES and are passed as -File/-argument
// values. Nothing is interpolated into a command string, so a printer name
// containing quotes or semicolons cannot become PowerShell code.
const RAW_PRINT_PS1 = `param(
  [Parameter(Mandatory=$true)][string]$PrinterName,
  [Parameter(Mandatory=$true)][string]$Path
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class MaestroRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFOW {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFOW di);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

  public static void SendBytes(string printerName, byte[] bytes) {
    IntPtr hPrinter;
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
      throw new Exception("cannot open printer (win32 error " + Marshal.GetLastWin32Error() + ")");
    try {
      DOCINFOW di = new DOCINFOW();
      di.pDocName = "Maestro Billing Receipt";
      di.pDataType = "RAW";
      if (!StartDocPrinter(hPrinter, 1, di))
        throw new Exception("StartDocPrinter failed (win32 error " + Marshal.GetLastWin32Error() + ")");
      try {
        if (!StartPagePrinter(hPrinter))
          throw new Exception("StartPagePrinter failed (win32 error " + Marshal.GetLastWin32Error() + ")");
        IntPtr buf = Marshal.AllocCoTaskMem(bytes.Length);
        try {
          Marshal.Copy(bytes, 0, buf, bytes.Length);
          int written;
          if (!WritePrinter(hPrinter, buf, bytes.Length, out written))
            throw new Exception("WritePrinter failed (win32 error " + Marshal.GetLastWin32Error() + ")");
          if (written != bytes.Length)
            throw new Exception("short write: " + written + " of " + bytes.Length + " bytes");
        } finally { Marshal.FreeCoTaskMem(buf); }
        EndPagePrinter(hPrinter);
      } finally { EndDocPrinter(hPrinter); }
    } finally { ClosePrinter(hPrinter); }
  }
}
'@
$bytes = [System.IO.File]::ReadAllBytes($Path)
[MaestroRawPrinter]::SendBytes($PrinterName, $bytes)
Write-Output ("SENT " + $bytes.Length)
`;

function sendRawToPrinter(printerName: string, bytes: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const stamp = randomBytes(6).toString('hex');
    const dir = os.tmpdir();
    const dataFile = path.join(dir, `maestro-print-${stamp}.bin`);
    const scriptFile = path.join(dir, `maestro-print-${stamp}.ps1`);

    const cleanup = () => {
      for (const f of [dataFile, scriptFile]) {
        try {
          fs.unlinkSync(f);
        } catch {
          // best effort — a stray temp file is not worth failing a print over
        }
      }
    };

    try {
      fs.writeFileSync(dataFile, bytes);
      fs.writeFileSync(scriptFile, RAW_PRINT_PS1, 'utf8');
    } catch (err) {
      cleanup();
      reject(err);
      return;
    }

    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptFile,
        '-PrinterName',
        printerName,
        '-Path',
        dataFile,
      ],
      { timeout: 20_000, windowsHide: true },
      (err, _stdout, stderr) => {
        cleanup();
        if (err) {
          // PowerShell's own message is far more actionable than execFile's
          // generic "Command failed" ("cannot open printer (win32 error 1801)"
          // = the printer name doesn't exist, for instance).
          const detail = String(stderr || '').trim().split('\n')[0] ?? '';
          reject(new Error(detail || err.message));
          return;
        }
        resolve();
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

  // POST /api/v1/printer/raw — send a prebuilt ESC/POS byte stream straight to
  // the thermal printer.
  //
  // Why this exists: printing the receipt PDF instead goes through the
  // browser's print pipeline, which rasterises the page and antialiases it.
  // The RP3160 is 1-bit, so those grey edge pixels get dithered into visible
  // fuzz, and a page-size mismatch also rescales the whole thing (which is
  // what the studio saw as blurry text plus a left-hand gap). Raw bytes let
  // the printer use its own built-in font, aligned to its own dot grid.
  fastify.post<{ Body: { data?: string } }>(
    '/raw',
    { preHandler: requireAppHeader },
    async (request, reply) => {
      const b64 = request.body?.data;
      if (typeof b64 !== 'string' || !b64) {
        return reply.status(400).send({ success: false, error: 'Missing ESC/POS payload.' });
      }
      // A receipt with a raster logo is tens of KB; anything far past that is
      // a bug or an abuse, and it would be spooled straight to hardware.
      if (b64.length > 2_000_000) {
        return reply.status(413).send({ success: false, error: 'Print payload too large.' });
      }

      let bytes: Buffer;
      try {
        bytes = Buffer.from(b64, 'base64');
      } catch {
        return reply.status(400).send({ success: false, error: 'Print payload is not valid base64.' });
      }
      if (bytes.length === 0) {
        return reply.status(400).send({ success: false, error: 'Print payload decoded to zero bytes.' });
      }

      // Prefer the exact Windows printer name we matched in /status — the
      // configured setting is a loose name ("RP-3160") that may not equal the
      // installed device's name ("RP3160 Printer"), and the spooler needs the
      // real one.
      const setting = await fastify.prisma.setting.findUnique({
        where: { key: 'thermal_printer_name' },
      });
      const configured = setting?.value?.trim() || 'RP-3160';
      let target = configured;
      try {
        const wanted = normalizeName(configured);
        const match = (await listWindowsPrinters()).find((p) => {
          const n = normalizeName(p.Name ?? '');
          return n.includes(wanted) || wanted.includes(n);
        });
        if (match?.Name) target = match.Name;
      } catch (err) {
        fastify.log.warn({ err }, 'Could not resolve exact printer name; using configured value');
      }

      try {
        await sendRawToPrinter(target, bytes);
      } catch (err) {
        fastify.log.error({ err, target }, 'Raw print failed');
        return reply.status(500).send({
          success: false,
          error: `Could not send the receipt to "${target}": ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }

      return reply.send({ success: true, data: { printer: target, bytes: bytes.length } });
    },
  );
}
