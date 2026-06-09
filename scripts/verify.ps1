$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"

function Invoke-Checked {
    param(
        [string] $FilePath,
        [string[]] $Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
    }
}

if (-not (Test-Path $Python)) {
    throw "Python virtual environment not found at $Python. Create it and install requirements first."
}

Push-Location $ProjectRoot
try {
    Invoke-Checked $Python @("-m", "py_compile", "my_actor\main.py", "my_actor\routes.py")
    Invoke-Checked $Python @("-m", "ruff", "check", ".")
    Invoke-Checked $Python @("-m", "ruff", "format", "--check", ".")
    Invoke-Checked $Python @("-m", "mypy")
}
finally {
    Pop-Location
}
