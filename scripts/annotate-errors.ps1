# Turns compiler errors in a build log into GitHub annotations (visible on the run page and
# through the API), several errors per annotation to stay under GitHub's limits.
param([string]$Log)
if (-not (Test-Path $Log)) { Write-Output "::error::No build log"; exit 0 }
$lines = Get-Content $Log | Where-Object { $_ -match '(: (fatal )?error |error [A-Z]+\d+:|: error:|LINK : |CMake Error)' } |
         ForEach-Object { ($_ -replace '^\s+', '') -replace '\[[^\]]*\.vcxproj\]', '' } | Select-Object -Unique
if (-not $lines) { $lines = Get-Content $Log | Select-Object -Last 30 }
$chunks = [System.Collections.ArrayList]@()
$cur = @()
foreach ($l in $lines | Select-Object -First 60) {
  $cur += $l
  if ($cur.Count -ge 6) { [void]$chunks.Add($cur -join '%0A'); $cur = @() }
}
if ($cur.Count) { [void]$chunks.Add($cur -join '%0A') }
foreach ($c in $chunks | Select-Object -First 10) { Write-Output "::error title=Build error::$c" }
