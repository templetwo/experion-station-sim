#!/bin/bash
# @artifact dev
# Double-click this. Station + granite coach in one browser window.
# Leave the Terminal window open while you train.
cd "$(dirname "$0")"
exec python3 tools/coach/launch.py
