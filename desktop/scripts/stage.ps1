# Stage clean node_modules copies for packaging.
#
# electron-builder's own copier follows the npm-workspace junctions inside
# codes/node_modules (photo-studio-billing-backend/-frontend point back into
# the repo) and silently drops packages when it hits them. robocopy /XJ
# excludes junctions, giving a complete, junction-free tree.

$ErrorActionPreference = 'Stop'
$desktop = Split-Path -Parent $PSScriptRoot
$codes = Split-Path -Parent $desktop

$pairs = @(
  @{ from = Join-Path $codes 'node_modules';          to = Join-Path $desktop 'staging\root_node_modules' },
  @{ from = Join-Path $codes 'backend\node_modules';  to = Join-Path $desktop 'staging\backend_node_modules' }
)

foreach ($p in $pairs) {
  Write-Host "Staging $($p.from) -> $($p.to)"
  # /XF *.tmp* drops leftover query_engine-*.dll.node.tmp<pid> files — Prisma
  # writes its query engine to a .tmp file and renames it into place, and an
  # interrupted `prisma generate` (locked DLL, killed process) can leave one
  # behind; each is tens of MB and would otherwise ship dead inside the
  # installer every time this happens.
  robocopy $p.from $p.to /E /XJ /PURGE /XF *.tmp* /NFL /NDL /NJH /NJS /NP | Out-Null
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

Write-Host "Staging complete."
exit 0
