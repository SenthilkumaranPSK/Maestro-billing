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
  robocopy $p.from $p.to /E /XJ /PURGE /NFL /NDL /NJH /NJS /NP | Out-Null
  # robocopy exit codes 0-7 mean success (1 = files copied)
  if ($LASTEXITCODE -gt 7) { Write-Error "robocopy failed with $LASTEXITCODE"; exit 1 }
}

Write-Host "Staging complete."
exit 0
