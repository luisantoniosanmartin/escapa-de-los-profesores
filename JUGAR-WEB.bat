@echo off
title ESCAPA DE LOS PROFESORES - servidor web
rem Levanta el servidor y abre el juego en el navegador.
start "servidor escapa" powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0servidor.ps1" -Porta 8321
timeout /t 2 /nobreak >nul
start "" "http://localhost:8321/"
echo.
echo   ESCAPA DE LOS PROFESORES
echo   Juego abierto en:  http://localhost:8321/
echo   Cierra la ventana "servidor escapa" para apagar el servidor.
echo.
pause
