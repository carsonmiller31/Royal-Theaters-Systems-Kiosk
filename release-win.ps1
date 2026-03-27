Param(
    [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoOwner = 'carsonmiller31'
$repoName = 'Royal-Theaters-Systems-Kiosk'
$repoSlug = "$repoOwner/$repoName"

function Write-Log {
    param([string]$Message)
    Write-Host "[release] $Message"
}

function Fail($Message) {
    Write-Error "[release][error] $Message"
    exit 1
}

# Ensure gh is authenticated
try {
    gh auth status | Out-Null
} catch {
    Fail "GitHub CLI not authenticated. Run: gh auth login"
}

# Determine version from package.json
$version = node -p "require('./package.json').version"
if (-not $version) { Fail 'Unable to read version from package.json' }
$tag = "v$version"
Write-Log "Version detected: $version ($tag)"

if (-not $SkipBuild) {
    Write-Log 'Building Windows installer with electron-builder...'
    try {
        npx electron-builder -w
    } catch {
        Fail 'Build failed. Ensure Node/npm are installed and try again.'
    }
}

# Find EXE
$exePath = Get-ChildItem -Path "dist" -Filter "*Setup-$version.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exePath) {
    Fail "Could not find EXE in dist for version $version."
}

$exeFile = $exePath.Name
$size = (Get-Item $exePath.FullName).Length

# Compute SHA512 (base64)
$sha512Bytes = [System.Security.Cryptography.SHA512]::Create().ComputeHash([System.IO.File]::ReadAllBytes($exePath.FullName))
$sha512 = [System.Convert]::ToBase64String($sha512Bytes)

# Write latest.yml
$latestPath = Join-Path "dist" "latest.yml"
@"
version: $version
files:
  - url: $exeFile
    sha512: $sha512
    size: $size
path: $exeFile
sha512: $sha512
releaseDate: '$(Get-Date).ToUniversalTime().ToString("s")Z'
"@ | Set-Content -Encoding UTF8 $latestPath

Write-Log "Wrote $latestPath"

# Create or update release
try {
    gh release view $tag --repo $repoSlug | Out-Null
    Write-Log "Release $tag exists; will upload assets."
} catch {
    Write-Log "Creating release $tag..."
    gh release create $tag --repo $repoSlug -t $tag -n "Automated Windows release for $tag"
}

# Upload assets
$assets = @()
$assets += $exePath.FullName
if (Test-Path ("{0}.blockmap" -f $exePath.FullName)) { $assets += ("{0}.blockmap" -f $exePath.FullName) }
if (Test-Path $latestPath) { $assets += $latestPath }

Write-Log ("Uploading assets: {0}" -f ($assets -join ', '))
gh release upload $tag @assets --repo $repoSlug --clobber

Write-Log ("Done. Release URL: https://github.com/{0}/releases/tag/{1}" -f $repoSlug, $tag)
