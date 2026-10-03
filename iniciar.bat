@echo off
REM ==========================================================================
REM  Massoterapia - iniciar o app com um duplo clique
REM ==========================================================================
REM  O que este script faz, em ordem:
REM    1. checa Node e pnpm
REM    2. cria o .env a partir do .env.example, com segredos aleatorios
REM    3. instala as dependencias (so na primeira vez)
REM    4. gera o Prisma Client e aplica as migrations
REM    5. semeia o banco de demonstracao (so na primeira vez)
REM    6. abre a API e o web em janelas separadas
REM    7. espera o app responder e abre o navegador
REM
REM  Duas janelas em vez de uma so porque API e web sao servicos
REM  diferentes: log misturado em um terminal unico esconde qual dos dois
REM  quebrou. E o turbo --parallel ainda sequestra o teclado em batch.
REM
REM  O fluxo usa labels, e nao blocos entre parenteses, de proposito:
REM  dentro de um bloco todo `%VAR%` e expandido no momento em que o bloco
REM  e lido, e nao quando a linha executa. `for /f` atribuindo uma variavel
REM  e usando ela na linha seguinte do mesmo bloco produz valor vazio --
REM  classico, e silencioso.
REM
REM  Para encerrar: feche as duas janelas, ou use parar.bat
REM ==========================================================================

setlocal EnableExtensions
cd /d "%~dp0"

set "RAIZ=%CD%"
set "NODE_MIN_MAJOR=22"

echo.
echo   Massoterapia
echo   ==========
echo.

REM --------------------------------------------------------------------------
REM  1. Pre-requisitos
REM --------------------------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 goto :sem_node

where pnpm >nul 2>nul
if errorlevel 1 goto :sem_pnpm

for /f "tokens=1 delims=." %%v in ('node -v') do set "NODE_MAJOR=%%v"
if not defined NODE_MAJOR goto :sem_node
if %NODE_MAJOR% LSS %NODE_MIN_MAJOR% goto :node_antigo
echo   [ok] Node %NODE_MAJOR% e pnpm encontrado

REM --------------------------------------------------------------------------
REM  2. .env e segredos
REM --------------------------------------------------------------------------
REM  A flag PRIMEIRA_VEZ controla o que e preciso fazer so uma vez. A
REM  variavel precisa existir antes de qualquer `if defined`, mesmo vazia.
set "PRIMEIRA_VEZ="
if exist ".env" goto :env_pronto
echo   [..] Criando .env
call node "scripts\criar-env.mjs"
if errorlevel 1 goto :falha_env
set "PRIMEIRA_VEZ=sim"
:env_pronto
echo   [ok] .env pronto

REM --------------------------------------------------------------------------
REM  3. Dependencias
REM --------------------------------------------------------------------------
if exist "node_modules" goto :deps_prontas
echo   [..] Instalando dependencias, pode demorar
call pnpm install --frozen-lockfile
if errorlevel 1 goto :falha_install
:deps_prontas
echo   [ok] Dependencias prontas

REM --------------------------------------------------------------------------
REM  4. Banco: client gerado e migrations aplicadas
REM --------------------------------------------------------------------------
echo   [..] Preparando o banco
call pnpm --filter @massoterapia/api db:generate
if errorlevel 1 goto :falha_banco

REM  `migrate deploy` e o certo aqui: nao abre shadow database, nao pergunta
REM  nome de migration e nao exige TTY. O que exige TTY e o `migrate dev`,
REM  que e por isso que ele nao e chamado deste script.
call pnpm --filter @massoterapia/api db:migrate:deploy
if errorlevel 1 goto :falha_banco
echo   [ok] Banco atualizado

REM --------------------------------------------------------------------------
REM  5. Seed, so na primeira execucao
REM --------------------------------------------------------------------------
REM  O seed e idempotente, mas refaz 6 hashes de senha com Argon2 e leva
REM  alguns segundos. Fora da primeira vez o banco ja tem dado e o balcao
REM  nao precisa esperar por isso so para abrir o app.
if not defined PRIMEIRA_VEZ goto :pular_seed
echo   [..] Semeando o banco de demonstracao
call pnpm --filter @massoterapia/api db:seed
if errorlevel 1 goto :falha_seed
echo   [ok] Banco semeado
goto :subir

:pular_seed
echo   [ok] Seed pulado. Para recriar os dados: pnpm --filter @massoterapia/api db:seed

REM --------------------------------------------------------------------------
REM  6. Sobe a API e o web em janelas separadas
REM --------------------------------------------------------------------------
:subir
echo   [..] Subindo a API (janela propria)
start "Massoterapia API" /D "%RAIZ%" cmd /k "pnpm --filter @massoterapia/api dev"

echo   [..] Subindo o web (janela propria)
start "Massoterapia Web" /D "%RAIZ%" cmd /k "pnpm --filter @massoterapia/web dev"

REM --------------------------------------------------------------------------
REM  7. Espera os dois servicos e abre o navegador
REM --------------------------------------------------------------------------
REM  Esperar so pela API nao basta: a API sobe em ~1s e o Vite leva ~2.5s
REM  para servir a primeira pagina. Abrir o navegador assim que a API
REM  responde abre uma pagina morta -- e o primeiro acesso do usuario
REM  seria um erro, nao o app.
echo   [..] Aguardando a API ficar pronta (ate 90s)
call :esperar "http://127.0.0.1:3333/health"
if errorlevel 1 goto :api_nao_subiu
echo   [ok] API respondendo

echo   [..] Aguardando o portal ficar pronto (ate 90s)
call :esperar "http://127.0.0.1:5173"
if errorlevel 1 goto :web_nao_subiu
echo   [ok] Portal respondendo

echo.
echo   ------------------------------------------------------------
echo    App no ar
echo.
echo    Portal     http://127.0.0.1:5173
echo    API        http://127.0.0.1:3333
echo    Swagger    http://127.0.0.1:3333/docs
echo.
echo    Login      admin@clinicawave.com.br
echo    Senha      Wave@2026
echo.
echo    Para encerrar, feche as duas janelas ou use parar.bat
echo   ------------------------------------------------------------
echo.

start "" "http://127.0.0.1:5173"
pause
exit /b 0

REM ==========================================================================
REM  Erros
REM ==========================================================================

:sem_node
echo   [ERRO] Node nao encontrado.
echo          Instale o Node %NODE_MIN_MAJOR% ou superior em https://nodejs.org
goto :falha

:node_antigo
echo   [ERRO] Node %NODE_MAJOR% e antigo demais. O projeto exige %NODE_MIN_MAJOR% ou superior.
goto :falha

:sem_pnpm
echo   [ERRO] pnpm nao encontrado.
echo          Rode: corepack enable
goto :falha

:falha_env
echo   [ERRO] Nao foi possivel criar o .env
goto :falha

:falha_install
echo   [ERRO] Falha em "pnpm install"
goto :falha

:falha_banco
echo.
echo   [ERRO] Nao foi possivel preparar o banco.
echo.
echo          As migrations falharam. As causas mais provaveis:
echo            - o PostgreSQL nao esta rodando
echo            - usuario e senha do .env nao batem
echo            - o banco "massoterapia_dev" ainda nao foi criado
echo.
echo          Para tentar de novo, com o log na tela:
echo            pnpm --filter @massoterapia/api db:migrate:deploy
goto :falha

:falha_seed
echo   [ERRO] Falha no seed do banco
goto :falha

:api_nao_subiu
echo   [ERRO] A API nao respondeu em 90 segundos.
echo.
echo          A janela "Massoterapia API" mostra o erro. Duas causas comuns:
echo            - a porta 3333 ja esta ocupada por outra instancia
echo              (rode parar.bat e tente de novo)
echo            - a janela da API esta fechada por falta de dependencia
goto :falha

:web_nao_subiu
echo   [ERRO] O portal nao respondeu em 90 segundos.
echo.
echo          A janela "Massoterapia Web" mostra o erro. A causa mais comum:
echo          a porta 5173 ja esta ocupada -- o vite esta com strictPort,
echo          e ele prefere falhar a trocar de porta do silenciosamente, porque
echo          um portal em 5174 quebraria o proxy de /api.
echo.
echo          Rode parar.bat e tente de novo.
goto :falha

:falha
echo.
echo   O app nao subiu. Esta janela fica aberta para voce ler o erro.
echo.
pause
exit /b 1

REM ==========================================================================
REM  esperar <url> - retorna codigo de erro != 0 se a URL nao responder
REM ==========================================================================
:esperar
set "URL=%~1"
set "TENTATIVAS=0"
:esperar_loop
powershell -NoProfile -Command "try { $null = Invoke-WebRequest -Uri '%URL%' -UseBasicParsing -TimeoutSec 2; exit 0 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 exit /b 0
set /a TENTATIVAS+=1
if %TENTATIVAS% GEQ 90 goto :esperar_fim
timeout /t 1 /nobreak >nul
goto :esperar_loop
:esperar_fim
exit /b 1
