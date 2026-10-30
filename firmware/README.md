# NFC terminal firmware 1.1.0 (FreeRTOS)

Standalone ESP32 NFC terminal: PN532 (I2C), W5500 Ethernet (HSPI),
ILI9341 display (VSPI), RGB LED. Wiring: `diagram/ESP32_wiring_diagram.pdf`.

## Build

Arduino IDE / arduino-cli, board **ESP32 Dev Module**, core **arduino-esp32 3.x**
(tested: 3.3.12). Libraries: TFT_eSPI (keep your existing `User_Setup.h`),
Adafruit PN532, Adafruit BusIO, ArduinoJson 7.

Open the folder `nfc_terminal/`. All `.cpp`/`.h` files in it belong to the sketch.

| Option (config.h) | Default | Meaning |
|---|---|---|
| `USE_W5500` | 1 | 0 = on-chip Wi-Fi instead of Ethernet |
| `ALLOW_PLAIN_HTTP` | **0** | 1 = also accept `http://` server URLs (sends secrets in clear text) |
| `MEASURE_LOG` | 0 | 1 = print `M,...` timing lines on serial (115200) |

Wi-Fi build uses 95% of the default 1.25 MB app partition. If you add code,
choose a partition scheme with a larger app slot that still has OTA.

## Architecture

| Task | Core / prio | Owns | Job |
|---|---|---|---|
| nfc | 1 / 4 | Wire, PN532 | polling, UID-aware latch (K = 3) |
| ui | 1 / 3 | TFT, LittleFS, LED | screens; result held by a timer, not `delay()` |
| net | 0 / 2 | HTTPClient, TLS | `check_card` request |
| api | 0 / 2 | WebServer :80, Update | `/`, `/connect`, `/diag`, `/ota` |
| sys | 0 / 1 | GPIO0 | BOOT gestures, restarts |

One request is in flight at a time. A slow server blocks only `net`; the
display, card reading and the local API keep working. All tasks are on the
task watchdog (30 s).

## Provisioning

**First configuration** (new or factory-reset device):

1. Short press BOOT (< 2 s). The display shows `Setup code: 123456` for 120 s.
2. Send the code as `otp`:

```
POST http://<terminal-ip>/connect
{"url":"https://api.example.com/terminal","api_key":"...","barrier":"...","otp":"123456"}
```

**Re-configuration** of a configured device: send the current barrier instead
of `otp`:

```
POST http://<terminal-ip>/connect
Authorization: <current barrier>
{"url":"...","api_key":"...","barrier":"<new or same>"}
```

Optional fields: `ca_cert` (PEM, ≤ 3800 chars; pins the server to this CA;
send `""` to return to the built-in bundle), `wifi_ssid`, `wifi_password`
(Wi-Fi build). No restart is needed except after a Wi-Fi change.

Wi-Fi build without credentials starts an open setup access point
`NFC-Setup-XXXX` (192.168.4.1). `/connect` still needs the display code.

**Upgrading a terminal from 1.0.1:** the old URL, api_key and barrier are
migrated automatically. If the old URL is `http://`, the terminal shows
`HTTPS required - reconfigure` — provision an `https://` URL or build with
`ALLOW_PLAIN_HTTP=1`. If the server uses a private/self-signed CA, provision
its certificate in `ca_cert`.

## Signed OTA

```
openssl ecparam -name prime256v1 -genkey -noout -out ota_private.pem
openssl ec -in ota_private.pem -pubout -out ota_public.pem
```

Paste `ota_public.pem` into `OTA_PUBLIC_KEY_PEM` in `api_task.cpp`, flash once
over USB, keep `ota_private.pem` off the device. Then:

```
tools/ota_sign_and_upload.sh build/nfc_terminal.ino.bin ota_private.pem <ip> <barrier>
```

An image with a wrong signature is rejected before the boot partition changes.
With an empty key, `/ota` returns 501.

## Not done in code (device-level settings)

* **Flash encryption / NVS encryption / Secure Boot** are eFuse settings
  burned with `espefuse.py`/`idf.py`; they cannot be enabled from a sketch and
  are irreversible. Recommended for production, after testing.
* Cryptographic cards (DESFire): needs reader-protocol work; UID only for now.

## Tests

```
cd tests
g++ -std=c++17 -O2 -Wall -Wextra -fsanitize=address,undefined -I../nfc_terminal provisioning_test.cpp -o provisioning_test && ./provisioning_test
g++ -std=c++17 -O2 -Wall -Wextra -fsanitize=address,undefined -I../nfc_terminal latch_test.cpp -o latch_test && ./latch_test
```

## Check on the device after flashing

1. Serial (115200): `[NFC] PN532 ...`, `[ETH] IP ...`, `[API] HTTP server on port 80`.
2. `GET /` returns your unit's own `serial_number`.
3. Provision with the BOOT code; tap a card → green/red as before.
4. Two different cards back-to-back → both are processed.
5. Stop the server → `Connection Error`, but `GET /` still answers within the 5 s.
6. `GET /diag` with `Authorization` → `stack_free_bytes` of every task > 500.
