#!/bin/sh
# Builds helper/dist/XDInput-unsigned.wgt (unsigned). The TizenBrew Installer re-signs it
# with the owner's Samsung certificate when installing on Tizen 7+.
set -e
cd "$(dirname "$0")"
mkdir -p dist
rm -f dist/XDInput-unsigned.wgt
(cd xd-input && zip -q -X -r ../dist/XDInput-unsigned.wgt config.xml index.html icon.png)
unzip -l dist/XDInput-unsigned.wgt
