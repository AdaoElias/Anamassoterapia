@echo off
setlocal
title Massoterapia - Lancador
cd /d "%~dp0"

REM Raiz do projeto = pasta deste script. Garante que os comandos rodam o pnpm
REM no diretorio certo mesmo se o launcher for aberto de outro lugar.
if not exist "%CD%\pnpm-workspace.yaml" (
  echo Pasta do projeto nao encontrada. Coloque este arquivo na raiz do repositorio.
  pause
  exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo pnpm nao foi encontrado no PATH.
  echo Instale Node.js 22+ e habilite o pnpm: corepack enable pnpm
  pause
  exit /b 1
)

:menu
cls
echo ========================================================
echo   MASSOTERAPIA - Lancador de desenvolvimento
echo ========================================================
echo.
echo   1  Iniciar API + Painel  (recomendado, abre o navegador)
echo   2  Iniciar somente a API
echo   3  Iniciar somente o Painel
echo   4  Migrations no banco de desenvolvimento
echo   5  Gate completo: lint + typecheck + testes + build
echo   6  Abrir o navegador no painel
echo   0  Sair
echo.
set /p opcao=Escolha: 

if "%opcao%"=="1" goto dev
if "%opcao%"=="2" goto api
if "%opcao%"=="3" goto web
if "%opcao%"=="4" goto migrate
if "%opcao%"=="5" goto check
if "%opcao%"=="6" goto browser
if "%opcao%"=="0" exit /b 0
goto menu

:dev
if not exist "%CD%\.env" (
  echo Primeira vez: criando o .env com segredos aleatorios...
  node "%CD%\scripts\criar-env.mjs"
  if errorlevel 1 (
    echo Falha ao criar o .env. Veja a saida acima.
    pause
    goto menu
  )
)
echo Abrindo API e Painel em janelas separadas...
REM O comando herda o diretorio atual (raiz) automaticamente.
start "Massoterapia - API" cmd /k "title Massoterapia - API && pnpm dev:api"
start "Massoterapia - Painel" cmd /k "title Massoterapia - Painel && pnpm dev:web"
echo.
echo   Painel .......... http://localhost:5173
echo   Docs da API ..... http://localhost:3333/docs
echo   Formulario publico: gerado no painel, Prontuario - Enviar link
echo.
echo Fechar as duas janelas novas encerra o servidor. Esta janela pode ser fechada.
pause
goto menu

:api
echo Verificando .env...
if not exist "%CD%\.env" (
  echo Criando o .env com segredos aleatorios...
  node "%CD%\scripts\criar-env.mjs"
)
echo Abrindo a API em uma janela separada...
start "Massoterapia - API" cmd /k "title Massoterapia - API && pnpm dev:api"
pause
goto menu

:web
start "Massoterapia - Painel" cmd /k "title Massoterapia - Painel && pnpm dev:web"
echo Painel em http://localhost:5173 (o Vite faz proxy do /api para a API).
pause
goto menu

:migrate
echo Rodando migrations de desenvolvimento. Confira a saida antes de continuar.
pause
pnpm --filter @massoterapia/api db:migrate
pause
goto menu

:check
echo Rodando o gate completo. Pode demorar alguns minutos...
pnpm run check
pause
goto menu

:browser
start "" http://localhost:5173
pause
goto menu