@echo off
setlocal
cd /d "%~dp0"
title TRB - Servidor local
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 serve_trb.py --open --auto-prefetch
  goto :end
)
where python >nul 2>nul
if %errorlevel%==0 (
  python serve_trb.py --open --auto-prefetch
  goto :end
)
echo Python 3 no esta instalado o no esta en PATH.
pause
exit /b 1
:end
pause
