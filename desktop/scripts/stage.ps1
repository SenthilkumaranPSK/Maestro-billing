# Stage clean copies of everything the installer packages, under desktop/.
#
# electron-builder's own copier follows the npm-workspace junctions inside
# codes/node_modules (photo-studio-billing-backend/-frontend point back into
# the repo) and silently drops packages when it hits them. robocopy /XJ
# excludes junctions, giving a complete, junction-free tree.
#
# Everything staged here — not just node_modules — because electron-builder's
# asar packer (asar: true) computes each packaged file's path relative to
# this app directory (desktop/) and throws ("<path> must be under
# .../desktop/") for any `files` entry sourced from outside it, e.g. the
# repo-root-relative `../backend/dist`. Staging a local copy under desktop/
# first sidesteps that entirely.

$ErrorActionPreference = 'Stop'
$desktop = Split-Path -Parent $PSScriptRoot
$codes = Split-Path -Parent $desktop

$pairs = @(
  @{ from = Join-Path $codes 'node_modules';          to = Join-Path $desktop 'staging\root_node_modules' },
  @{ from = Join-Path $codes 'backend\node_modules';  to = Join-Path $desktop 'staging\backend_node_modules' },
  @{ from = Join-Path $codes 'backend\dist';          to = Join-Path $desktop 'staging\backend_dist' },
  @{ from = Join-Path $codes 'backend\prisma';        to = Join-Path $desktop 'staging\backend_prisma' },
  @{ from = Join-Path $codes 'frontend\dist';         to = Join-Path $desktop 'staging\frontend_dist' }
)

foreach ($p in $pairs) {
  Write-Host "Staging $($p.from) -> $($p.to)"
  # Wipe the destination first, THEN copy — /XF below excludes matching
  # files from the copy, but robocopy also excludes them from its /PURGE
  # comparison (an excluded file is treated as if it doesn't exist on either
  # side), so a stale file that was staged in some earlier run before it
  # started matching /XF (e.g. a source file that has since been deleted)
  # would otherwise never get cleaned up — found ~130MB of exactly that
  # (dead .tmp<pid> Prisma engine copies with no matching source file at
  # all) sitting in staging from a previous run.
  if (Test-Path $p.to) { Remove-Item $p.to -Recurse -Force }
  # /XF *.tmp* drops leftover query_engine-*.dll.node.tmp<pid> files — Prisma
  # writes its query engine to a .tmp file and renames it into place, and an
  # interrupted `prisma generate` (locked DLL, killed process) can leave one
  # behind; each is tens of MB and would otherwise ship dead inside the
  # installer every time this happens.
  robocopy $p.from $p.to /E /XJ /XF *.tmp* /NFL /NDL /NJH /NJS /NP | Out-Null
  # robocopy exit codes 0-7 mean success (1 = files copied)
  if ($LASTEXITCODE -gt 7) { Write-Error "robocopy failed with $LASTEXITCODE"; exit 1 }
}

# npm's hoisting decisions for the puppeteer family (puppeteer-extra and its
# stealth plugin) are unstable across installs — they usually land at the
# workspace root, but their own transitive deps (puppeteer-core plus ITS deps
# like @puppeteer/browsers) sometimes land in backend/node_modules instead.
# In the packaged app, code under app/backend/dist resolves up through
# app/backend/node_modules to app/node_modules, but a package that itself
# lives in app/node_modules (like puppeteer-extra) can only resolve further
# packages from app/node_modules upward — never back down into
# app/backend/node_modules. So app/node_modules (root) must be a strict
# superset. Merge staged backend deps into staged root deps (fill gaps only,
# never delete) to guarantee that regardless of how this install happened to
# split things.
Write-Host "Merging backend deps into root staging (puppeteer dependency completeness)"
robocopy (Join-Path $desktop 'staging\backend_node_modules') (Join-Path $desktop 'staging\root_node_modules') /E /XJ /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -gt 7) { Write-Error "robocopy merge failed with $LASTEXITCODE"; exit 1 }

# Single file — robocopy is for directory trees, so a plain copy here instead.
Write-Host "Staging backend/package.json"
Copy-Item (Join-Path $codes 'backend\package.json') (Join-Path $desktop 'staging\backend_package.json') -Force

Write-Host "Staging complete."
exit 0
