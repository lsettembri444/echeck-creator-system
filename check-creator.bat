@echo off
title eCheque Creator by Lemmon
cd /d %~dp0

REM Abre el navegador (si todavía no está el server, cargará y luego refrescás)
start "" "http://localhost:3000"

REM Arranca el server SIN "start" (evita el bug de libuv/process_title)
pnpm dev
