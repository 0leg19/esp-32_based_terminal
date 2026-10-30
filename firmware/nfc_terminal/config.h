// config.h - build options, pin map and timing constants (firmware 1.1.0).
//
// The pin map matches the wiring diagram (diagram/ESP32_wiring_diagram.pdf).
// The ILI9341 pins are defined in TFT_eSPI/User_Setup.h:
//   MOSI 23, MISO 19, SCLK 18, CS 15, DC 2, RST 4, SPI 27 MHz (VSPI).

#pragma once

#include <stdint.h>

// ============================================================
// BUILD OPTIONS
// ============================================================

// 1 = W5500 Ethernet (default), 0 = on-chip Wi-Fi.
#ifndef USE_W5500
#define USE_W5500 1
#endif

// 0 = only https:// server URLs are accepted (production default).
// 1 = http:// is accepted as well (development / isolated LAN only:
//     x-api-key and Authorization are then sent in clear text).
#ifndef ALLOW_PLAIN_HTTP
#define ALLOW_PLAIN_HTTP 0
#endif

// 1 = print machine-readable timing lines ("M,...") on the serial port
//     for the empirical measurements (poll results, request latency).
#ifndef MEASURE_LOG
#define MEASURE_LOG 0
#endif

// ============================================================
// IDENTITY
// ============================================================

#define SOFTWARE_VERSION "1.1.0"
#define MODEL            "ESP32_RFID_001"
#define CREATOR          "0leg19"
#define FOOTER_BRAND     "github.com/0leg19"
// Serial and unique numbers are derived from the chip's factory MAC at run
// time, so every unit flashed with the same image has its own identity.

// ============================================================
// PINS (unchanged from 1.0.1)
// ============================================================

// PN532 NFC, I2C 0x24 @ 100 kHz
constexpr int PIN_PN532_SDA   = 21;
constexpr int PIN_PN532_SCL   = 22;
constexpr int PIN_PN532_IRQ   = 33;
constexpr int PIN_PN532_RESET = 32;

// W5500 Ethernet, own HSPI bus
constexpr int PIN_W5500_SCK  = 14;
constexpr int PIN_W5500_MOSI = 27;
constexpr int PIN_W5500_MISO = 26;
constexpr int PIN_W5500_CS   = 13;
constexpr int PIN_W5500_RST  = 25;   // output-capable (not GPIO34-39)
constexpr int PIN_W5500_INT  = -1;   // not connected

// RGB LED, common cathode, 220-330 ohm per colour
constexpr int  PIN_LED_R = 5;
constexpr int  PIN_LED_G = 17;
constexpr int  PIN_LED_B = 16;
constexpr bool RGB_COMMON_ANODE = false;

// BOOT button (on the DevKit board). GPIO0 is a strapping pin: if it is
// held while the chip leaves reset, the ROM bootloader starts instead of
// this firmware. All button gestures are therefore detected at run time.
constexpr int PIN_BOOT_BUTTON = 0;

// ============================================================
// TIMING
// ============================================================

constexpr uint32_t NFC_POLL_TIMEOUT_MS   = 250;
constexpr uint32_t NFC_RETRY_INTERVAL_MS = 5000;
constexpr uint32_t NFC_HEALTH_INTERVAL_MS = 30000;
constexpr uint8_t  CARD_MISS_THRESHOLD   = 3;     // K

constexpr uint32_t HTTP_TIMEOUT_MS        = 5000;
constexpr uint32_t TLS_HANDSHAKE_TIMEOUT_S = 10;

// Network recovery. Without an IP address for NET_RECOVERY_MS (no cable,
// no DHCP answer, hung W5500) the W5500 is restarted, and again every
// NET_RECOVERY_MS until an address is obtained. After a connection error
// the server is probed (TCP connect to host:port) every SERVER_RETRY_MS
// until it answers; if it stays unreachable for NET_STALL_RESTART_MS while
// the link is up, the W5500 is restarted as well.
constexpr uint32_t NET_RECOVERY_MS         = 30000;
constexpr uint32_t SERVER_RETRY_MS         = 15000;
constexpr uint32_t SERVER_PROBE_TIMEOUT_MS = 3000;
constexpr uint32_t NET_STALL_RESTART_MS    = 300000;

constexpr uint16_t RESULT_HOLD_MS  = 2500;
constexpr uint16_t WAITING_HOLD_MS = 25000;  // replaced by the result
constexpr uint16_t BUSY_HOLD_MS    = 1500;

constexpr uint32_t PROVISION_WINDOW_MS  = 120000;
constexpr uint8_t  PROVISION_MAX_TRIES  = 5;
constexpr uint32_t BUTTON_DEBOUNCE_MS   = 50;
constexpr uint32_t BUTTON_HINT_MS       = 2000;
constexpr uint32_t BUTTON_FACTORY_RESET_MS = 5000;

constexpr uint8_t  AUTH_MAX_FAILURES = 5;
constexpr uint32_t AUTH_LOCKOUT_MS   = 60000;

constexpr uint32_t WDT_TIMEOUT_MS   = 30000;
constexpr uint32_t RESTART_DELAY_MS = 750;
constexpr size_t   MAX_CONNECT_BODY = 6000;

// ============================================================
// DISPLAY
// ============================================================

#define DISPLAY_ROTATION       2
#define DISPLAY_FOOTER_HEIGHT  40
#define AUTO_SCALE_BMP         1

// ============================================================
// FREERTOS TASKS (core, priority, stack in bytes)
// ============================================================
// NFC and UI form the user-facing loop and run on core 1 above Net, so a
// slow server or TLS handshake can never delay feedback for the next card.

constexpr int      NFC_TASK_CORE = 1, NFC_TASK_PRIO = 4;
constexpr uint32_t NFC_TASK_STACK = 4096;
constexpr int      UI_TASK_CORE  = 1, UI_TASK_PRIO  = 3;
constexpr uint32_t UI_TASK_STACK  = 6144;
constexpr int      NET_TASK_CORE = 0, NET_TASK_PRIO = 2;
constexpr uint32_t NET_TASK_STACK = 12288;   // TLS
constexpr int      API_TASK_CORE = 0, API_TASK_PRIO = 2;
constexpr uint32_t API_TASK_STACK = 10240;   // JSON + OTA signature check
constexpr int      SYS_TASK_CORE = 0, SYS_TASK_PRIO = 1;
constexpr uint32_t SYS_TASK_STACK = 3072;
