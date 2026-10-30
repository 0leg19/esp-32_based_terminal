// app_state.cpp - shared state implementation (firmware 1.1.0).

#include "app_state.h"

#include <esp_mac.h>
#include <esp_random.h>
#include <mbedtls/sha256.h>

#if !USE_W5500
#include <WiFi.h>
#endif

namespace app {

std::atomic<bool> linkUp{false};
std::atomic<bool> netUp{false};
std::atomic<uint32_t> ipv4{0};
std::atomic<bool> serverDown{false};
std::atomic<bool> apMode{false};
std::atomic<bool> nfcReady{false};
std::atomic<bool> netBusy{false};
std::atomic<bool> otaActive{false};
TerminalStats stats;

QueueHandle_t uidQueue = nullptr;
QueueHandle_t uiQueue = nullptr;

TaskHandle_t hNfc = nullptr, hNet = nullptr, hUi = nullptr, hApi = nullptr, hSys = nullptr;

static SemaphoreHandle_t cfgMutex = nullptr;
static SemaphoreHandle_t provMutex = nullptr;
static TerminalConfig currentConfig;
static prov::OtpWindow otpWindow;
static prov::AuthThrottle authThrottle(AUTH_MAX_FAILURES, AUTH_LOCKOUT_MS);
static std::atomic<uint32_t> restartAtMs{0};
static std::atomic<bool> restartPending{false};

void initState() {
    cfgMutex = xSemaphoreCreateMutex();
    provMutex = xSemaphoreCreateMutex();
    uidQueue = xQueueCreate(1, sizeof(CardEvent));
    uiQueue = xQueueCreate(8, sizeof(UiEvent));
    configASSERT(cfgMutex && provMutex && uidQueue && uiQueue);
}

TerminalConfig config() {
    xSemaphoreTake(cfgMutex, portMAX_DELAY);
    TerminalConfig copy = currentConfig;
    xSemaphoreGive(cfgMutex);
    return copy;
}

void setConfig(const TerminalConfig &cfg) {
    xSemaphoreTake(cfgMutex, portMAX_DELAY);
    currentConfig = cfg;
    xSemaphoreGive(cfgMutex);
}

bool isConfigured() {
    xSemaphoreTake(cfgMutex, portMAX_DELAY);
    const bool configured = currentConfig.configured;
    xSemaphoreGive(cfgMutex);
    return configured;
}

static uint32_t hardwareRandom() { return esp_random(); }

void provOpen() {
    xSemaphoreTake(provMutex, portMAX_DELAY);
    otpWindow.open(millis(), prov::makeOtpCode(hardwareRandom),
                   PROVISION_WINDOW_MS, PROVISION_MAX_TRIES);
    xSemaphoreGive(provMutex);
}

bool provIsOpen() {
    xSemaphoreTake(provMutex, portMAX_DELAY);
    const bool open = otpWindow.isOpen(millis());
    xSemaphoreGive(provMutex);
    return open;
}

bool provCode(char out[prov::OTP_DIGITS + 1], uint32_t &remainingMs) {
    xSemaphoreTake(provMutex, portMAX_DELAY);
    const uint32_t now = millis();
    const bool open = otpWindow.isOpen(now);
    if (open) {
        memcpy(out, otpWindow.code(), prov::OTP_DIGITS + 1);
        remainingMs = otpWindow.remainingMs(now);
    }
    xSemaphoreGive(provMutex);
    return open;
}

prov::OtpWindow::Check provCheck(const char *otp, size_t n) {
    xSemaphoreTake(provMutex, portMAX_DELAY);
    const prov::OtpWindow::Check result = otpWindow.check(otp, n, millis());
    xSemaphoreGive(provMutex);
    return result;
}

void provClose() {
    xSemaphoreTake(provMutex, portMAX_DELAY);
    otpWindow.close();
    xSemaphoreGive(provMutex);
}

bool authAllowed() {
    xSemaphoreTake(provMutex, portMAX_DELAY);
    const bool allowed = authThrottle.allowed(millis());
    xSemaphoreGive(provMutex);
    return allowed;
}

void authFailure() {
    xSemaphoreTake(provMutex, portMAX_DELAY);
    authThrottle.failure(millis());
    xSemaphoreGive(provMutex);
}

void authSuccess() {
    xSemaphoreTake(provMutex, portMAX_DELAY);
    authThrottle.success();
    xSemaphoreGive(provMutex);
}

void uiShow(Icon icon, const char *text, uint16_t holdMs) {
    UiEvent ev{};
    ev.icon = icon;
    ev.holdMs = holdMs;
    strlcpy(ev.text, text != nullptr ? text : "", sizeof(ev.text));
    // Never block the caller on the UI; if the queue is full, drop the
    // oldest event so the newest state is always shown.
    if (xQueueSend(uiQueue, &ev, 0) != pdTRUE) {
        UiEvent dropped;
        xQueueReceive(uiQueue, &dropped, 0);
        xQueueSend(uiQueue, &ev, 0);
    }
}

static void factoryMac(uint8_t mac[6]) {
    esp_read_mac(mac, ESP_MAC_EFUSE_FACTORY);
}

String serialNumber() {
    uint8_t mac[6];
    factoryMac(mac);
    char buf[32];
    snprintf(buf, sizeof(buf), "ESP32_RFID_%02X%02X%02X%02X%02X%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    return String(buf);
}

// 32 hex characters, same format as the fixed value of 1.0.x, but unique
// per chip: first 16 bytes of SHA-256(factory MAC || model).
String uniqueNumber() {
    uint8_t mac[6];
    factoryMac(mac);
    uint8_t digest[32];
    mbedtls_sha256_context ctx;
    mbedtls_sha256_init(&ctx);
    mbedtls_sha256_starts(&ctx, 0);
    mbedtls_sha256_update(&ctx, mac, sizeof(mac));
    mbedtls_sha256_update(&ctx, reinterpret_cast<const uint8_t *>(MODEL), strlen(MODEL));
    mbedtls_sha256_finish(&ctx, digest);
    mbedtls_sha256_free(&ctx);
    char hex[33];
    for (int i = 0; i < 16; i++) {
        snprintf(hex + i * 2, 3, "%02x", digest[i]);
    }
    return String(hex);
}

String ipString() {
#if USE_W5500
    // Cached from the network events: the Net task may restart the W5500
    // (ETH.end() frees the interface), so other tasks must not query ETH.
    return IPAddress(ipv4.load()).toString();
#else
    if (apMode.load()) return WiFi.softAPIP().toString();
    return WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : String("0.0.0.0");
#endif
}

const char *networkType() {
#if USE_W5500
    return "ETHERNET";
#else
    return apMode.load() ? "WIFI_AP" : "WIFI";
#endif
}

void scheduleRestart(uint32_t delayMs) {
    restartAtMs.store(millis() + delayMs);
    restartPending.store(true);
}

bool restartDue() {
    return restartPending.load() &&
           static_cast<int32_t>(millis() - restartAtMs.load()) >= 0;
}

}  // namespace app
