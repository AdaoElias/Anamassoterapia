@echo off
REM ==========================================================================
REM  Massoterapia - parar o app
REM ==========================================================================
REM  Duas situacoes que este script resolve:
REM
REM    1. A porta 3333 ou 5173 ficou ocupada e "pnpm dev" reclama de
REM       EADDRINUSE. Acontece toda vez que a janela do app e fechada pelo
REM       X em vez de Ctrl+C: o tsx watch e o vite ficam vivos.
REM
REM    2. Sobrou processo antigo do projeto segurando a porta, de sessao
REM       anterior. E o que aconteceu nesta sessao: um PID 24488 que
REM      started as 22:44 continuava respondendo 200 e fazendo o novo
REM       processo recusar a porta.
REM
REM  So mata processo que escuta estas portas. Nao varre o node inteiro:
REM  outro projeto node seu pode estar rodando e nao e da conta deste
REM  script derrubar.
REM ==========================================================================

setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo   Massoterapia - parar
echo   ===================
echo.

REM  Portas do projeto: 3333 e da API, 5173 e do Vite.
powershell -NoProfile -Command "$portas = 3333,5173; $alvos = Get-NetTCPConnection -State Listen -EA SilentlyContinue | Where-Object { $portas -contains $_.LocalPort } | Select-Object -ExpandProperty OwningProcess -Unique; if (-not $alvos) { exit 3 }; foreach ($id in $alvos) { $p = Get-Process -Id $id -EA SilentlyContinue; if ($p) { Write-Output ('  Encerrando PID ' + $id + ' (' + $p.ProcessName + ', porta ' + (Get-NetTCPConnection -State Listen -OwningProcess $id -EA SilentlyContinue | Select-Object -First 1 -ExpandProperty LocalPort) + ')'); Stop-Process -Id $id -Force -EA SilentlyContinue } }"

if errorlevel 3 (
  echo   Nenhum processo escutando nas portas 3333 e 5173. Nada a fazer.
) else if errorlevel 1 (
  echo   [ERRO] Nao foi possivel encerrar os processos.
  echo          Feche as janelas do app manualmente.
) else (
  echo   [ok] Portas 3333 e 5173 liberadas.
)

echo.
pause
