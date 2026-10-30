// ui_task.cpp - display and RGB LED, owned exclusively by the UI task
// (firmware 1.1.0). Drawing code is carried over from 1.0.1; the blocking
// delay(2500) is replaced by a hold timer, so other tasks keep running.

#include "app_state.h"

#include <FS.h>
#include <LittleFS.h>
#include <SPI.h>
#include <TFT_eSPI.h>
#include <esp_task_wdt.h>

static TFT_eSPI tft;
static bool fileSystemReady = false;

// ============================================================
// RGB LED
// ============================================================

static void writeRgbPin(int pin, bool on) {
    digitalWrite(pin, RGB_COMMON_ANODE ? !on : on);
}

static void setRgbLed(bool r, bool g, bool b) {
    writeRgbPin(PIN_LED_R, r);
    writeRgbPin(PIN_LED_G, g);
    writeRgbPin(PIN_LED_B, b);
}

static void setLedForIcon(Icon icon) {
    switch (icon) {
        case Icon::Success:    setRgbLed(false, true, false); break;
        case Icon::Fail:
        case Icon::NoServer:
        case Icon::NoInternet:
        case Icon::NoIp:       setRgbLed(true, false, false); break;
        case Icon::Progress:   setRgbLed(false, false, true); break;
        case Icon::Unknown:
        case Icon::Setup:      setRgbLed(true, true, false); break;
        case Icon::TapCard:
        case Icon::Waiting:    setRgbLed(false, true, true); break;
        default:               setRgbLed(false, false, false); break;
    }
}

static const char *iconPath(Icon icon) {
    switch (icon) {
        case Icon::Boot:       return "/boot_logo.bmp";
        case Icon::Waiting:    return "/status_waiting.bmp";
        case Icon::Unknown:    return "/status_unknown.bmp";
        case Icon::TapCard:    return "/status_tap_card.bmp";
        case Icon::Success:    return "/status_success.bmp";
        case Icon::Progress:   return "/status_progress.bmp";
        case Icon::NoServer:   return "/status_no_server.bmp";
        case Icon::NoIp:       return "/status_no_ip.bmp";
        case Icon::NoInternet: return "/status_no_internet.bmp";
        case Icon::Fail:       return "/status_fail.bmp";
        case Icon::Setup:      return "/status_setup.bmp";
    }
    return "/status_unknown.bmp";
}

// ============================================================
// BMP (unchanged logic from 1.0.1)
// ============================================================

static uint16_t rgb888To565(uint8_t r, uint8_t g, uint8_t b) {
    return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}

static uint16_t read16(File &f) {
    uint8_t b[2];
    if (f.read(b, 2) != 2) return 0;
    return static_cast<uint16_t>(b[0]) | (static_cast<uint16_t>(b[1]) << 8);
}

static uint32_t read32(File &f) {
    uint8_t b[4];
    if (f.read(b, 4) != 4) return 0;
    return static_cast<uint32_t>(b[0]) | (static_cast<uint32_t>(b[1]) << 8) |
           (static_cast<uint32_t>(b[2]) << 16) | (static_cast<uint32_t>(b[3]) << 24);
}

static bool readBmpHeader(File &f, uint32_t &pixelOffset, int32_t &w, int32_t &h, bool &topDown) {
    if (read16(f) != 0x4D42) return false;
    read32(f); read16(f); read16(f);
    pixelOffset = read32(f);
    if (read32(f) < 40) return false;
    w = static_cast<int32_t>(read32(f));
    h = static_cast<int32_t>(read32(f));
    const uint16_t planes = read16(f);
    const uint16_t bitDepth = read16(f);
    const uint32_t compression = read32(f);
    if (w <= 0 || h == 0 || planes != 1 || bitDepth != 24 || compression != 0) return false;
    topDown = h < 0;
    if (topDown) h = -h;
    return true;
}

static bool drawIcon(const char *path) {
    if (!fileSystemReady) return false;
    File f = LittleFS.open(path, "r");
    if (!f) {
        Serial.printf("[UI] missing %s\n", path);
        return false;
    }

    uint32_t pixelOffset = 0;
    int32_t width = 0, height = 0;
    bool topDown = false;
    if (!readBmpHeader(f, pixelOffset, width, height, topDown)) {
        Serial.printf("[UI] unsupported BMP %s\n", path);
        f.close();
        return false;
    }

    const int16_t areaW = tft.width();
    const int16_t areaH = max(1, tft.height() - DISPLAY_FOOTER_HEIGHT);
    uint8_t scale = 1;
#if AUTO_SCALE_BMP
    const int32_t s = min(areaW / width, areaH / height);
    if (s >= 1) scale = static_cast<uint8_t>(min<int32_t>(s, 255));
#endif
    const int32_t sw = width * scale, sh = height * scale;
    if (sw > areaW || sh > areaH) {
        f.close();
        return false;
    }
    const int16_t x = (areaW - sw) / 2;
    const int16_t y = (areaH - sh) / 2;

    const uint32_t rowSize = ((static_cast<uint32_t>(width) * 3U + 3U) / 4U) * 4U;
    uint8_t *row = static_cast<uint8_t *>(malloc(rowSize));
    uint16_t *line = static_cast<uint16_t *>(malloc(static_cast<size_t>(sw) * sizeof(uint16_t)));
    if (row == nullptr || line == nullptr) {
        free(row);
        free(line);
        f.close();
        return false;
    }

    bool ok = true;
    tft.startWrite();
    for (int32_t r = 0; r < height && ok; r++) {
        const int32_t src = topDown ? r : (height - 1 - r);
        if (!f.seek(pixelOffset + static_cast<uint32_t>(src) * rowSize) ||
            f.read(row, rowSize) != rowSize) {
            ok = false;
            break;
        }
        for (int32_t c = 0; c < width; c++) {
            const uint16_t color = rgb888To565(row[c * 3 + 2], row[c * 3 + 1], row[c * 3]);
            for (uint8_t k = 0; k < scale; k++) line[c * scale + k] = color;
        }
        for (uint8_t k = 0; k < scale; k++) {
            const int16_t dy = y + r * scale + k;
            if (dy >= 0 && dy < tft.height()) tft.pushImage(x, dy, sw, 1, line);
        }
    }
    tft.endWrite();

    free(row);
    free(line);
    f.close();
    return ok;
}

// ============================================================
// FOOTER
// ============================================================

static void drawFooter(const char *status) {
    const int16_t top = tft.height() - DISPLAY_FOOTER_HEIGHT;
    const int16_t w = tft.width();
    tft.fillRect(0, top, w, DISPLAY_FOOTER_HEIGHT, TFT_BLACK);
    tft.setTextWrap(false);

    const size_t len = strlen(status);
    const size_t largeChars = (w - 10) / 12;
    const size_t smallChars = (w - 10) / 6;

    tft.setTextColor(TFT_WHITE, TFT_BLACK);
    if (len <= largeChars) {
        tft.setTextSize(2);
        tft.setCursor((w - static_cast<int16_t>(len) * 12) / 2, top + 4);
        tft.print(status);
    } else {
        tft.setTextSize(1);
        char part[64];
        const size_t n1 = min(len, smallChars);
        memcpy(part, status, min(n1, sizeof(part) - 1));
        part[min(n1, sizeof(part) - 1)] = '\0';
        tft.setCursor(5, top + 3);
        tft.print(part);
        if (len > smallChars) {
            const size_t n2 = min(len - smallChars, smallChars);
            memcpy(part, status + smallChars, min(n2, sizeof(part) - 1));
            part[min(n2, sizeof(part) - 1)] = '\0';
            tft.setCursor(5, top + 13);
            tft.print(part);
        }
    }

    // The ready screen shows the IP address as its status line; do not
    // repeat it next to the brand.
    const String ip = app::ipString();
    const bool statusIsIp = ip == status;
    const int16_t brandW = static_cast<int16_t>(strlen(FOOTER_BRAND)) * 6;

    tft.setTextSize(1);
    if (!statusIsIp) {
        tft.setTextColor(TFT_CYAN, TFT_BLACK);
        tft.setCursor(5, top + 28);
        tft.print("IP: ");
        tft.print(ip);
    }
    tft.setTextColor(TFT_DARKGREY, TFT_BLACK);
    tft.setCursor(statusIsIp ? (w - brandW) / 2 : w - 5 - brandW, top + 28);
    tft.print(FOOTER_BRAND);
}

// ============================================================
// SCREEN STATE
// ============================================================

static bool haveScreen = false;
static Icon shownIcon = Icon::Boot;
static char shownText[80] = "";
static String shownIp;

static void show(Icon icon, const char *text) {
    const String ip = app::ipString();
    const bool iconChanged = !haveScreen || icon != shownIcon;
    const bool textChanged = !haveScreen || strcmp(text, shownText) != 0 || ip != shownIp;
    if (!iconChanged && !textChanged) return;

    if (iconChanged) {
        tft.fillScreen(TFT_BLACK);
        // Images added after 1.1.0 may be missing on a terminal whose
        // LittleFS was not re-uploaded: fall back to the generic one.
        if (!drawIcon(iconPath(icon))) drawIcon(iconPath(Icon::Unknown));
        setLedForIcon(icon);
        shownIcon = icon;
    }
    drawFooter(text);
    strlcpy(shownText, text, sizeof(shownText));
    shownIp = ip;
    haveScreen = true;
}

// Screen when no transient message is active. Priority from top to bottom.
static void baseScreen(Icon &icon, char *text, size_t cap) {
    char code[prov::OTP_DIGITS + 1];
    uint32_t remaining = 0;

    if (app::otaActive) {
        icon = Icon::Progress;
        strlcpy(text, "Updating firmware...", cap);
    } else if (app::provCode(code, remaining)) {
        icon = Icon::Unknown;
        snprintf(text, cap, "Setup code: %s (%lus)", code, static_cast<unsigned long>(remaining / 1000));
    } else if (!app::nfcReady) {
        icon = Icon::Fail;
        strlcpy(text, "NFC Error", cap);
    } else if (app::apMode) {
        icon = Icon::Unknown;
        strlcpy(text, "Wi-Fi setup: press BOOT, use app", cap);
    } else if (!app::linkUp) {
        icon = Icon::NoInternet;
        strlcpy(text, USE_W5500 ? "No Network (check cable)" : "No Network (Wi-Fi)", cap);
    } else if (!app::netUp) {
        icon = Icon::NoIp;
        strlcpy(text, "No IP (waiting for DHCP)", cap);
    } else if (!app::isConfigured()) {
        icon = Icon::Setup;
        strlcpy(text, "Needs Config (App)", cap);
    } else if (app::netBusy) {
        icon = Icon::Waiting;
        strlcpy(text, "Checking access...", cap);
    } else if (app::serverDown) {
        icon = Icon::NoServer;
        strlcpy(text, "Server unreachable - retrying", cap);
    } else {
        icon = Icon::TapCard;
        strlcpy(text, app::ipString().c_str(), cap);  // ready: show the address
    }
}

// ============================================================
// INIT + TASK
// ============================================================

void uiHardwareInit() {
    pinMode(PIN_LED_R, OUTPUT);
    pinMode(PIN_LED_G, OUTPUT);
    pinMode(PIN_LED_B, OUTPUT);
    // Start-up self test: red, green, blue, white.
    setRgbLed(true, false, false);  delay(250);
    setRgbLed(false, true, false);  delay(250);
    setRgbLed(false, false, true);  delay(250);
    setRgbLed(true, true, true);

    tft.init();
    tft.setRotation(DISPLAY_ROTATION);
    tft.setSwapBytes(true);
    tft.fillScreen(TFT_BLACK);

    // Never format automatically: a failed mount must not erase the icons.
    fileSystemReady = LittleFS.begin(false);
    Serial.println(fileSystemReady ? "[UI] LittleFS mounted" : "[UI] LittleFS mount failed");
    if (fileSystemReady) drawIcon(iconPath(Icon::Boot));
}

void uiTask(void *) {
    esp_task_wdt_add(nullptr);

    bool transient = false;
    uint32_t transientUntil = 0;
    UiEvent ev;

    for (;;) {
        esp_task_wdt_reset();

        if (xQueueReceive(app::uiQueue, &ev, pdMS_TO_TICKS(100)) == pdTRUE) {
            show(ev.icon, ev.text);
            transient = ev.holdMs > 0;
            transientUntil = millis() + ev.holdMs;
            continue;
        }

        if (transient && static_cast<int32_t>(millis() - transientUntil) < 0) {
            continue;
        }
        transient = false;

        Icon icon;
        char text[80];
        baseScreen(icon, text, sizeof(text));
        show(icon, text);
    }
}
