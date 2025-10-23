@echo off
REM Force ASCII code page to avoid mojibake in cmd
chcp 437 >nul
cd /d %~dp0

REM Elevate to Administrator if not already (required for winget/service control)
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoLogo -NoProfile -Command "Start-Process PowerShell -Verb RunAs -ArgumentList '-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File','\"%~dp0start.ps1\"'"
  goto :eof
)

REM Run PowerShell orchestrator
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
pause


