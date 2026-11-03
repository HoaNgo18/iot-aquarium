[CmdletBinding()]
param(
    [string]$Python = 'python',
    [string]$CoreDirectory = (Join-Path $PSScriptRoot '.pio-core'),
    [ValidateSet('esp32-fake', 'esp32-sensors', 'esp32-pending-sensors', 'esp32-ph-bench')]
    [string[]]$Environment = @('esp32-fake', 'esp32-sensors')
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$null = New-Item -ItemType Directory -Force -Path $CoreDirectory
$coreRoot = (Resolve-Path -LiteralPath $CoreDirectory).Path
$previousCore = $env:PLATFORMIO_CORE_DIR
$mappedDrives = [System.Collections.Generic.List[string]]::new()
$buildExit = 1

function Mount-BuildPath([string]$Target) {
    # Legacy Xtensa GCC cannot handle Unicode paths. SUBST creates aliases only.
    # Use only unused letters and release only mappings created by this invocation.
    foreach ($letter in [char[]](90..68)) {
        $drive = "${letter}:"
        if ((Test-Path "${drive}\") -or (Get-PSDrive -Name $letter -ErrorAction SilentlyContinue)) { continue }
        & subst.exe $drive $Target
        if ($LASTEXITCODE -eq 0) {
            $mappedDrives.Add($drive)
            return $drive
        }
    }
    throw 'No free drive letter for the temporary firmware build path.'
}

try {
    $projectDrive = Mount-BuildPath $projectRoot
    $coreDrive = Mount-BuildPath $coreRoot
    $env:PLATFORMIO_CORE_DIR = "${coreDrive}\"
    $buildArgs = @('-m', 'platformio', 'run', '--project-dir', "${projectDrive}\")
    foreach ($item in $Environment) { $buildArgs += @('--environment', $item) }
    & $Python @buildArgs
    $buildExit = $LASTEXITCODE
}
finally {
    $env:PLATFORMIO_CORE_DIR = $previousCore
    foreach ($drive in $mappedDrives) {
        # /D removes the drive alias, not its files or directory.
        & subst.exe $drive /D
        if ($LASTEXITCODE -ne 0) { Write-Warning "Could not release temporary drive $drive" }
    }
}
if ($buildExit -ne 0) { throw "Firmware build failed with exit code $buildExit" }
