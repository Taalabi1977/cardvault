#!/bin/sh
# Builds the claude.ai Artifact trial page from index.html (no doctype/head wrapper, no CSP meta).
cd "$(dirname "$0")/.." && mkdir -p dist-artifact
{
  sed -n '/CV:HEAD-START/,/CV:HEAD-END/p' index.html | grep -v 'CV:HEAD' | grep -v 'Content-Security-Policy' | grep -v 'rel="manifest"'
  sed -n '/CV:BODY-START/,/CV:BODY-END/p' index.html | grep -v 'CV:BODY'
} > dist-artifact/page.html
mkdir -p dist-artifact/lang
for f in vendor/tesseract/lang/*.traineddata.gz; do base64 -w0 "$f" > "dist-artifact/lang/$(basename "$f").b64.txt"; done
