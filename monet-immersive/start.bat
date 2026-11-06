@echo off
cd /d "%~dp0"
echo Monet Immersive - http://localhost:8123  (close this window to stop)
start "" "http://localhost:8123/"
python -m http.server 8123 || py -m http.server 8123
pause
