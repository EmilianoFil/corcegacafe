@echo off
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS=%STARTUP%\CorcegaPrintService.vbs"

if exist "%VBS%" (
    del "%VBS%"
    echo OK  Servicio de inicio desinstalado.
) else (
    echo El servicio de inicio no estaba instalado.
)
pause
