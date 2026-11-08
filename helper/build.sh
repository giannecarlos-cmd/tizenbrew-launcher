#!/bin/sh
# Local unsigned build, for inspection only (the TV rejects unsigned packages).
# Installable signed packages come from .github/workflows/sign-helper.yml.
set -e
cd "$(dirname "$0")"
mkdir -p dist
rm -f dist/XDInput-unsigned.wgt
(cd xd-input && zip -q -X -r ../dist/XDInput-unsigned.wgt config.xml index.html icon.png)
unzip -l dist/XDInput-unsigned.wgt
