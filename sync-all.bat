@echo off
rem ==========================================================================
rem  sync-all.bat - sync every data source used by Bata WMS, in one go
rem
rem    1/3  MySQL dispatch + receiving  -> Supabase   (node sync.js --once)
rem         used by: Home KPIs and other Supabase-backed views
rem    2/3  Warehouse manifest (IS_Warehouse) -> Supabase (python sync_manifest.py)
rem         used by: Transport, Article search by Order Date, warehouse timeline
rem    3/3  Yusen daily report -> Supabase  (node import-yusen.js)
rem         used by: Yusen steps of the timeline, Yusen alerts
rem
rem  Live views (dispatch / transfer / return / shipment status) read MySQL
rem  directly and need no sync.
rem
rem  Double-click to run (window waits at the end), or
rem  "sync-all.bat /auto" for Task Scheduler (no pause).
rem  Every run is appended to logs\sync-all.log
rem ==========================================================================
setlocal
cd /d "%~dp0"
if not exist logs mkdir logs
set "LOG=logs\sync-all.log"
set "TMPOUT=%TEMP%\bata-sync-step.txt"
set FAILED=0
set FAILLIST=

echo ================================================== >> "%LOG%"
echo [%date% %time%] sync-all START >> "%LOG%"
echo Bata WMS - sync all data sources
echo Log file: %LOG%

call :step "1/3 MySQL dispatch+receiving -> Supabase" "node sync.js --once" "Sync FAILED"
call :step "2/3 Warehouse manifest -> Supabase" "python sync_manifest.py" ""
if exist import-yusen.js (
  call :step "3/3 Yusen report -> Supabase" "node import-yusen.js" ""
) else (
  echo.
  echo ---- 3/3 Yusen report: skipped, import-yusen.js not found ----
  echo [%date% %time%] 3/3 skipped - import-yusen.js not found >> "%LOG%"
)

echo.
echo ==================================================
if %FAILED%==0 (
  echo  ALL DONE - every step finished OK
) else (
  echo  FINISHED WITH %FAILED% FAILED STEP^(S^):%FAILLIST%
  echo  See details in %LOG%
)
echo ==================================================
echo [%date% %time%] sync-all END - failed=%FAILED%%FAILLIST% >> "%LOG%"
if exist "%TMPOUT%" del "%TMPOUT%" >nul 2>&1
if /i not "%~1"=="/auto" pause
exit /b %FAILED%

rem --------------------------------------------------------------------------
rem  :step "<name>" "<command>" "<text in output that also means failure>"
rem --------------------------------------------------------------------------
:step
echo.
echo ---- %~1 ---- running, please wait...
echo. >> "%LOG%"
echo [%date% %time%] ---- %~1 : %~2 >> "%LOG%"
%~2 > "%TMPOUT%" 2>&1
set RC=%errorlevel%
type "%TMPOUT%"
type "%TMPOUT%" >> "%LOG%"
if not "%~3"=="" (
  findstr /c:"%~3" "%TMPOUT%" >nul 2>&1 && set RC=1
)
if not "%RC%"=="0" (
  set /a FAILED+=1
  set "FAILLIST=%FAILLIST% [%~1]"
  echo ^>^> FAILED: %~1
  echo [%date% %time%] FAILED rc=%RC% >> "%LOG%"
) else (
  echo ^>^> OK: %~1
  echo [%date% %time%] OK >> "%LOG%"
)
exit /b 0
