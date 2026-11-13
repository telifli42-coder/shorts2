@echo off
cd /d "%~dp0"
echo Kurulum yapiliyor...
python -m pip install --upgrade yt-dlp imageio-ffmpeg
call npm install
echo.
echo Kurulum tamam. "baslat.bat" ile baslatabilirsin.
pause