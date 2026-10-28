@echo off
cd /d "%~dp0"
echo Updating FootyStats upcoming fixtures...
python export_fixtures.py
echo Done.
