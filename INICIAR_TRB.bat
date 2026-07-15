@echo off
setlocal
cd /d "%~dp0"
title TRB - Servidor local

echo.
echo ==============================================
echo   TRB - Preparando 93 recorridos KMZ
echo ==============================================
echo.

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 serve_trb.py --prepare --open
  goto :end
)

where python >nul 2>nul
if %errorlevel%==0 (
  python serve_trb.py --prepare --open
  goto :end
)

echo No se encontro Python en este computador.
echo Instala Python 3 desde https://www.python.org/downloads/
echo Durante la instalacion activa la opcion "Add Python to PATH".
echo.
pause
exit /b 1

:end
echo.
echo TRB se cerro. Si viste un error, revisa kmz_errors.json.
pause
