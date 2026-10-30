#!/usr/bin/env bash
# Sign a firmware image and upload it to a terminal (firmware >= 1.1.0).
#
# usage: ota_sign_and_upload.sh <firmware.bin> <ota_private.pem> <terminal-ip> <barrier>
#
# The terminal verifies the ECDSA P-256 / SHA-256 signature against the
# public key compiled into api_task.cpp (OTA_PUBLIC_KEY_PEM) before it
# switches the boot partition.
set -euo pipefail

if [[ $# -ne 4 ]]; then
    echo "usage: $0 <firmware.bin> <ota_private.pem> <terminal-ip> <barrier>" >&2
    exit 2
fi

BIN=$1
KEY=$2
HOST=$3
BARRIER=$4

[[ -f "$BIN" ]] || { echo "firmware not found: $BIN" >&2; exit 1; }
[[ -f "$KEY" ]] || { echo "private key not found: $KEY" >&2; exit 1; }

SIG_FILE=$(mktemp)
trap 'rm -f "$SIG_FILE"' EXIT

openssl dgst -sha256 -sign "$KEY" -out "$SIG_FILE" "$BIN"
SIG_HEX=$(xxd -p "$SIG_FILE" | tr -d '\n')

curl --fail-with-body --show-error --silent \
     -H "Authorization: ${BARRIER}" \
     -H "X-Signature: ${SIG_HEX}" \
     -F "firmware=@${BIN};type=application/octet-stream" \
     "http://${HOST}/ota"
echo
