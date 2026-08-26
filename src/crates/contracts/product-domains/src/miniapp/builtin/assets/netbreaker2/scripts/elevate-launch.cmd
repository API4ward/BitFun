@echo off
REM NetBreaker2 elevation wrapper. Invoked only after an explicit UAC prompt.
REM Usage: elevate-launch.cmd <kernel> <config> <workdir> <pidfile> <logfile>
setlocal
set "KERNEL=%~1"
set "CONFIG=%~2"
set "WORKDIR=%~3"
set "PIDFILE=%~4"
set "LOGFILE=%~5"
if not exist "%WORKDIR%" mkdir "%WORKDIR%"
powershell -NoProfile -WindowStyle Hidden -Command ^
  "$p = Start-Process -FilePath '%KERNEL%' -ArgumentList @('-d','%WORKDIR%','-f','%CONFIG%') -WindowStyle Hidden -PassThru -RedirectStandardOutput '%LOGFILE%' -RedirectStandardError '%LOGFILE%'; Set-Content -Path '%PIDFILE%' -Value $p.Id"
