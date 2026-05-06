@echo off
REM ============================================================
REM  Avvia il backend in locale.
REM  Prima crea il file .env con le tue credenziali (vedi .env.example).
REM ============================================================

IF NOT EXIST .env (
    echo ERRORE: file .env non trovato!
    echo Copia .env.example in .env e compila JWT_SECRET, MAIL_USERNAME, MAIL_PASSWORD
    pause
    exit /b 1
)

REM Carica le variabili da .env (ignora righe con #)
FOR /F "usebackq tokens=1,* delims==" %%A IN (`findstr /v "^#" .env`) DO (
    SET %%A=%%B
)

echo Avvio backend su http://localhost:8080 ...
echo Apri il browser su http://localhost:8080 dopo l'avvio.
echo.

call mvnw.cmd spring-boot:run
