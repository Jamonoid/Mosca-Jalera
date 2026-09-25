@echo off
rem Inicia el servidor local de la simulacion y abre el navegador.
set PORT=8765
cd /d "%~dp0"

netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul
if %errorlevel%==0 (
  echo El servidor ya esta corriendo en el puerto %PORT%.
) else (
  echo Iniciando servidor en http://localhost:%PORT%/ ...
  start "Servidor Fly" /min py tools\serve.py %PORT%
  timeout /t 2 /nobreak >nul
)

start "" http://localhost:%PORT%/
