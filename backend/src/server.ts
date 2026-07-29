import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { PrismaClient } from '@prisma/client';

import { customerRoutes } from './routes/customers';
import { mmCustomerRoutes } from './routes/mmCustomers';
import { productRoutes } from './routes/products';
import { mmProductRoutes } from './routes/mmProducts';
import { serviceRoutes } from './routes/services';
import { billRoutes } from './routes/bills';
import { settingsRoutes } from './routes/settings';
import { whatsappRoutes } from './routes/whatsapp';
import { backupRoutes } from './routes/backups';
import { printerRoutes } from './routes/printer';
import { reportRoutes } from './routes/reports';
import { errorHandler } from './middleware/errorHandler';
import { WhatsAppService } from './services/WhatsAppService';
import { BackupService, getConfiguredBackupDir } from './services/BackupService';
import { ReportService, previousMonthYm } from './services/ReportService';
import { runPendingMigrations } from './utils/runMigrations';

const prisma = new PrismaClient();
const whatsapp = new WhatsAppService();

// Safety nets: a stray rejection or exception in a background task (WhatsApp
// reconnects, auto-backup timer) must never take the billing app down mid-day.
// Log loudly and keep serving — availability wins for a single-user local app.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

async function main() {
  const isDev = process.env.NODE_ENV !== 'production';

  // Bring an existing database up to the current schema before anything
  // else touches it — an installer upgrade replaces this app's code but
  // never the user's already-installed database file. See runMigrations.ts.
  const migrationsDir = path.resolve(__dirname, '..', 'prisma', 'migrations');
  await runPendingMigrations(prisma, migrationsDir);

  const app = Fastify({
    bodyLimit: 10_485_760, // 10 MB
    logger: {
      level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
      ...(isDev
        ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
        : {}),
    },
  });

  // Decorators
  app.decorate('prisma', prisma);
  app.decorate('whatsapp', whatsapp);

  // ── Plugins ──────────────────────────────────────────────────────────────
  // CORS — support a comma-separated list of origins from the env var so the
  // app can be moved to a different port or LAN device without a code change.
  const rawOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
  const corsOrigins = rawOrigin.split(',').map((o) => o.trim()).filter(Boolean);
  // Never fall back to '*' — with credentials:true that would let any web page
  // the operator visits call this API. An empty/blank env var gets the default.
  if (corsOrigins.length === 0) corsOrigins.push('http://localhost:5173');

  await app.register(cors, {
    origin: corsOrigins,
    credentials: true,
  });
  // script-src 'self' is the meaningful backstop (blocks any injected/inline
  // <script>, the actual XSS-relevant vector); style-src stays permissive
  // because the app's own components render via inline style attributes —
  // tightening that would need a much larger refactor for little extra gain
  // here (no user-controlled HTML is ever injected as a style value).
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        // Printing (lib/pdf.ts printBillPDF) loads the generated receipt into
        // a hidden <iframe src="blob:..."> so window.print() can print it.
        // frame-src isn't set here, so it fell back to default-src 'self' —
        // which does NOT match blob: — silently blocking every print attempt.
        frameSrc: ["'self'", 'blob:'],
        // helmet's default CSP directives include this unless explicitly
        // removed — it tells the browser to silently rewrite every http://
        // sub-resource request to https://. This app is intentionally
        // HTTP-only (127.0.0.1 loopback, no TLS cert anywhere), so every
        // asset request (JS bundle, CSS, images) was getting "upgraded" to
        // an https:// URL nothing listens on, then reported as
        // ERR_BLOCKED_BY_CSP — the app failed to load every single time.
        // `null` is helmet's documented way to delete a default directive.
        upgradeInsecureRequests: null,
      },
    },
  });

  app.setErrorHandler(errorHandler);

  // ── Routes ───────────────────────────────────────────────────────────────
  await app.register(customerRoutes, { prefix: '/api/v1/customers' });
  await app.register(mmCustomerRoutes, { prefix: '/api/v1/mm-customers' });
  await app.register(productRoutes,  { prefix: '/api/v1/products'  });
  await app.register(mmProductRoutes, { prefix: '/api/v1/mm-products' });
  await app.register(serviceRoutes,  { prefix: '/api/v1/services'  });
  await app.register(billRoutes,     { prefix: '/api/v1/bills'     });
  await app.register(settingsRoutes, { prefix: '/api/v1/settings'  });
  await app.register(whatsappRoutes, { prefix: '/api/v1/whatsapp'  });
  await app.register(backupRoutes,   { prefix: '/api/v1/backups'   });
  await app.register(printerRoutes,  { prefix: '/api/v1/printer'   });
  await app.register(reportRoutes,   { prefix: '/api/v1/reports'   });

  // ── Static frontend (single-process mode) ────────────────────────────────
  // When a built frontend exists (production / desktop app), serve it from
  // this same process so the whole app lives at one URL. In dev, Vite serves
  // the frontend itself and this block is skipped (no dist folder).
  const frontendDist =
    process.env.FRONTEND_DIST ?? path.resolve(__dirname, '..', '..', 'frontend', 'dist');
  if (fs.existsSync(path.join(frontendDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: frontendDist });
    // SPA fallback: deep links like /history must serve index.html; real API
    // and asset misses keep their 404s. A path ending in a file extension
    // (e.g. a stale-cached /assets/index-<oldhash>.js after an update) is
    // treated as a missing asset, not a client route, so it 404s cleanly
    // instead of returning HTML that the browser then fails to parse as JS.
    app.setNotFoundHandler((request, reply) => {
      const pathname = request.url.split('?')[0] ?? '';
      const looksLikeFile = /\.[a-zA-Z0-9]+$/.test(pathname);
      if (request.method === 'GET' && !pathname.startsWith('/api') && !looksLikeFile) {
        // Not reply.sendFile() — that relies on @fastify/static's ambient
        // type augmentation of FastifyReply resolving correctly, which is
        // fragile across npm workspace hoisting layouts (its declared
        // `import ... from 'fastify'` can fail to resolve to the same
        // `fastify` package this file's own types come from, silently
        // dropping the augmentation). A plain read+send has no such
        // dependency and is exactly as correct for a small, rarely-served
        // SPA shell file.
        return reply.type('text/html').send(fs.readFileSync(path.join(frontendDist, 'index.html')));
      }
      return reply.status(404).send({ success: false, error: 'Not found' });
    });
    app.log.info(`Serving frontend from ${frontendDist}`);
  }

  // ── Health ───────────────────────────────────────────────────────────────
  // /live  — liveness probe: the process is up (never touches the DB)
  app.get('/live', async () => ({ status: 'ok', version: process.env.APP_VERSION ?? 'dev' }));

  // /health — readiness probe: pings the database; returns 503 if unreachable
  app.get('/health', async (_req, reply) => {
    try {
      await prisma.$queryRawUnsafe('SELECT 1');
      return reply.send({ status: 'ok', db: 'ok' });
    } catch {
      return reply.status(503).send({ status: 'error', db: 'unreachable' });
    }
  });

  // ── SQLite hardening ─────────────────────────────────────────────────────
  // WAL survives crashes/power cuts far better than the default rollback
  // journal (and it's persistent — set once, stored in the DB file).
  // busy_timeout makes SQLite wait instead of throwing "database is locked"
  // when a backup or second connection briefly holds the file.
  try {
    await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL');
    await prisma.$queryRawUnsafe('PRAGMA busy_timeout=5000');
    await prisma.$queryRawUnsafe('PRAGMA foreign_keys=ON');
  } catch (err) {
    app.log.warn({ err }, 'Failed to apply SQLite pragmas');
  }

  // ── Graceful shutdown ────────────────────────────────────────────────────
  let shuttingDown = false;
  // autoBackup/autoMonthlyReport below are deferred a few seconds past boot
  // and re-run daily via setInterval — both scheduled independently of this
  // handler. Without tracking them, a quit landing in that window could hit
  // process.exit() while one was mid-write (fs.copyFileSync / PDF
  // generation), leaving a truncated backup or report file behind — worse
  // than not having one, since a truncated .db still looks like a valid
  // backup in the list until someone tries to restore it. Cleared/awaited
  // here the same way WhatsAppService already tracks its own init timer.
  let backupTimer: NodeJS.Timeout | undefined;
  let reportTimer: NodeJS.Timeout | undefined;
  let backupInFlight: Promise<void> | null = null;
  let reportInFlight: Promise<void> | null = null;
  async function closeHandler(signal: string) {
    if (shuttingDown) return; // a second Ctrl+C must not re-enter close()
    shuttingDown = true;
    app.log.info(`Received ${signal}, shutting down…`);
    clearTimeout(backupTimer);
    clearTimeout(reportTimer);
    // Failsafe: if close hangs (e.g. WhatsApp's Chrome refusing to die),
    // force-exit after 10s rather than leaving a zombie process.
    const failsafe = setTimeout(() => process.exit(1), 10_000);
    failsafe.unref();
    await whatsapp.shutdown().catch(() => {});
    await (backupInFlight ?? Promise.resolve()).catch(() => {});
    await (reportInFlight ?? Promise.resolve()).catch(() => {});
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  }
  process.on('SIGINT',  () => closeHandler('SIGINT'));
  process.on('SIGTERM', () => closeHandler('SIGTERM'));

  const port = parseInt(process.env.PORT ?? '3001');
  const host = process.env.HOST ?? '127.0.0.1';
  await app.listen({ port, host });
  app.log.info(`Server running at http://${host}:${port}`);

  // ── Automatic backup ──────────────────────────────────────────────────────
  // Take a backup on every boot (at most one per calendar day) and then every
  // 24 hours while the server stays up. The operator never has to remember.
  const autoBackup = async () => {
    try {
      const customDir = await getConfiguredBackupDir(prisma);
      const svc = new BackupService(customDir);
      if (svc.hasBackupForDate(new Date())) {
        app.log.info('Auto-backup skipped — a backup already exists for today');
        return;
      }
      const file = await svc.backup();
      app.log.info(`Auto-backup created: ${file}`);
    } catch (err) {
      app.log.error({ err }, 'Auto-backup failed');
    }
  };
  const runAutoBackup = () => {
    if (shuttingDown) return;
    backupInFlight = autoBackup().finally(() => { backupInFlight = null; });
  };
  // Deferred a few seconds so this doesn't compete with the frontend's very
  // first load for CPU/DB access right as the app opens — the daily cadence
  // doesn't care about a few seconds' difference in when the check runs.
  backupTimer = setTimeout(runAutoBackup, 4000);
  setInterval(runAutoBackup, 24 * 60 * 60 * 1000).unref();

  // ── Automatic monthly GST report ────────────────────────────────────────
  // Once a calendar month has fully closed, generate its GST summary PDF
  // unattended — the operator shouldn't have to remember to open the GST
  // Report page and export it before filing. Checked on every boot and once
  // a day, same cadence/idempotency pattern as auto-backup above: skip if
  // that month's PDF already exists, generate if not.
  const autoMonthlyReport = async () => {
    try {
      const svc = new ReportService(prisma);
      const ym = previousMonthYm();
      if (svc.hasReportFor(ym)) return;
      const file = await svc.generateGstReportPdf(ym);
      app.log.info(`Monthly GST report generated: ${file}`);
    } catch (err) {
      app.log.error({ err }, 'Automatic monthly report generation failed');
    }
  };
  const runAutoMonthlyReport = () => {
    if (shuttingDown) return;
    reportInFlight = autoMonthlyReport().finally(() => { reportInFlight = null; });
  };
  // Same reasoning as autoBackup above — staggered slightly later so the
  // two deferred startup jobs don't land in the same instant either.
  reportTimer = setTimeout(runAutoMonthlyReport, 7000);
  setInterval(runAutoMonthlyReport, 24 * 60 * 60 * 1000).unref();
}

main().catch((err) => {
  console.error(err);
  // Running standalone (npm start / a CLI use) — exiting non-zero is the
  // correct signal to whatever launched us. Running embedded in Electron's
  // main process (desktop/main.js requires this module in-process, not as a
  // child process), process.exit() here would kill the ENTIRE app instantly
  // — before Electron's own waitForServer retry loop and "could not start"
  // dialog (main.js) ever get a chance to run, so the app would just vanish
  // with zero on-screen explanation (e.g. if the port is already bound by a
  // stale process). Leave the process alive and let that existing dialog
  // path handle it instead.
  if (process.versions.electron) return;
  process.exit(1);
});

// ── Type augmentation ─────────────────────────────────────────────────────────
declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    whatsapp: WhatsAppService;
  }
}
