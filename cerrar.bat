@echo off
rem Cierra el servidor local de la simulacion (lo que escuche en el puerto 8765).
set PORT=8765
set FOUND=0

for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do (
  taskkill /PID %%p /F >nul 2>&1
  set FOUND=1
)

if %FOUND%==1 (
  echo Servidor cerrado.
) else (
  echo No habia ningun servidor corriendo en el puerto %PORT%.
)
timeout /t 2 /nobreak >nul
