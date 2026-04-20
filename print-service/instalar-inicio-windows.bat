@echo off
:: ──────────────────────────────────────────────────────────────────
:: Instala el servicio de impresion en el Inicio de Windows.
:: Doble clic para instalar. Se ejecuta automaticamente al encender la PC.
:: ──────────────────────────────────────────────────────────────────

set "SERVICIO_DIR=%~dp0"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS=%STARTUP%\CorcegaPrintService.vbs"

echo Instalando en: %STARTUP%
echo.

:: Crear el .vbs que lanza node oculto (sin ventana negra)
(
echo Set WshShell = CreateObject^("WScript.Shell"^)
echo WshShell.Run "cmd /c cd /d ""%SERVICIO_DIR%"" ^&^& node index.js >> ""%SERVICIO_DIR%imprimir.log"" 2^>^&1", 0, False
) > "%VBS%"

if exist "%VBS%" (
    echo OK  Instalado correctamente.
    echo     Se ejecutara automaticamente cuando enciendas la PC.
    echo.
    echo Para desinstalar: borrar el archivo:
    echo     %VBS%
) else (
    echo ERROR: No se pudo crear el archivo de inicio.
    echo Intenta ejecutar como administrador.
)

echo.
pause
