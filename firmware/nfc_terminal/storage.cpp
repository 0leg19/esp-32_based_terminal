// storage.cpp - configuration in NVS + one-time migration from the
// EEPROM layout of firmware 1.0.x (firmware 1.1.0).
//
// NVS can be encrypted together with flash encryption (see README);
// the legacy EEPROM area is wiped after a successful migration.

#include "app_state.h"

#include <EEPROM.h>
#include <Preferences.h>

static const char *NVS_NAMESPACE = "nfcterm";

static bool putStr(Preferences &p, const char *key, const String &value) {
    if (value.length() == 0) {
        p.remove(key);  // absent key == empty value
        return true;
    }
    return p.putString(key, value) == value.length();
}

bool storageLoad(TerminalConfig &cfg) {
    Preferences p;
    if (!p.begin(NVS_NAMESPACE, true)) {
        return false;  // namespace does not exist yet
    }
    cfg.configured = p.getBool("configured", false);
    cfg.url = p.getString("url", "");
    cfg.apiKey = p.getString("api_key", "");
    cfg.barrier = p.getString("barrier", "");
    cfg.caCert = p.getString("ca_cert", "");
    cfg.wifiSsid = p.getString("wifi_ssid", "");
    cfg.wifiPass = p.getString("wifi_pass", "");
    p.end();

    if (cfg.configured && (cfg.url.length() == 0 || cfg.barrier.length() == 0)) {
        cfg.configured = false;  // inconsistent entry: treat as unconfigured
    }
    return true;
}

bool storageSave(const TerminalConfig &cfg) {
    Preferences p;
    if (!p.begin(NVS_NAMESPACE, false)) {
        return false;
    }
    bool ok = true;
    ok &= putStr(p, "url", cfg.url);
    ok &= putStr(p, "api_key", cfg.apiKey);
    ok &= putStr(p, "barrier", cfg.barrier);
    ok &= putStr(p, "ca_cert", cfg.caCert);
    ok &= putStr(p, "wifi_ssid", cfg.wifiSsid);
    ok &= putStr(p, "wifi_pass", cfg.wifiPass);
    // Written last, so a power loss mid-way leaves the device unconfigured
    // rather than half-configured.
    ok &= p.putBool("configured", ok && cfg.configured) == 1;
    p.end();
    return ok;
}

void storageClear() {
    Preferences p;
    if (p.begin(NVS_NAMESPACE, false)) {
        p.clear();
        p.end();
    }
}

// ---- legacy EEPROM map of 1.0.1 (offset, size) ----
namespace legacy {
constexpr int EEPROM_SIZE = 1024;
constexpr int KEY_STATUS = 0,    SIZE_STATUS = 4;
constexpr int KEY_BARRIER = 40,  SIZE_BARRIER = 64;
constexpr int KEY_URL = 156,     SIZE_URL = 350;
constexpr int KEY_API = 512,     SIZE_API = 64;

String readSlot(int key, int size) {
    String value;
    for (int i = 0; i < size; i++) {
        const uint8_t raw = EEPROM.read(key + i);
        if (raw == 0x00 || raw == 0xFF || raw == ';') break;
        value += static_cast<char>(raw);
    }
    return value;
}
}  // namespace legacy

bool storageMigrateLegacy(TerminalConfig &cfg) {
    if (!EEPROM.begin(legacy::EEPROM_SIZE)) {
        return false;
    }
    const String status = legacy::readSlot(legacy::KEY_STATUS, legacy::SIZE_STATUS);
    const String url = legacy::readSlot(legacy::KEY_URL, legacy::SIZE_URL);
    const String api = legacy::readSlot(legacy::KEY_API, legacy::SIZE_API);
    const String barrier = legacy::readSlot(legacy::KEY_BARRIER, legacy::SIZE_BARRIER);

    const bool legacyConfigured = (status == "1111" || status == "111") &&
                                  url.length() > 0 && barrier.length() > 0;
    if (!legacyConfigured) {
        EEPROM.end();
        return false;
    }

    TerminalConfig migrated;
    migrated.url = url;
    migrated.apiKey = api;
    migrated.barrier = barrier;
    migrated.configured = true;

    if (!storageSave(migrated)) {
        EEPROM.end();
        return false;
    }

    for (int i = 0; i < legacy::EEPROM_SIZE; i++) {
        EEPROM.write(i, 0x00);
    }
    EEPROM.commit();
    EEPROM.end();

    Serial.println("[CFG] migrated configuration from 1.0.x EEPROM to NVS");
    cfg = migrated;
    return true;
}
