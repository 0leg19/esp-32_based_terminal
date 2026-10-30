// app_state.h - shared state, queues and inter-task API (firmware 1.1.0).
//
// Ownership rules:
//   NFC task  : Wire + PN532
//   UI task   : TFT_eSPI, LittleFS, RGB LED pins
//   Net task  : HTTPClient / TLS client
//   API task  : WebServer (port 80), OTA writer
//   Sys task  : BOOT button, scheduled restart
// Tasks exchange data only through the queues and the guarded accessors
// below; no task calls into a driver owned by another task.

#pragma once

#include <Arduino.h>
#include <atomic>

#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/semphr.h>
#include <freertos/task.h>

#include "card_latch.h"
#include "config.h"
#include "provisioning.h"

struct TerminalConfig {
    String url;
    String apiKey;
    String barrier;
    String caCert;    // optional PEM; empty = built-in CA bundle
    String wifiSsid;  // Wi-Fi build only
    String wifiPass;
    bool configured = false;
};

enum class Icon : uint8_t {
    Boot, Waiting, Unknown, TapCard, Success, Progress,
    NoServer, NoIp, NoInternet, Fail, Setup,
};

struct UiEvent {
    Icon icon;
    uint16_t holdMs;
    char text[80];
};

struct CardEvent {
    uint8_t uid[CARD_LATCH_MAX_UID];
    uint8_t uidLength;
    uint32_t detectedMs;
};

struct TerminalStats {
    std::atomic<uint32_t> polls{0};
    std::atomic<uint32_t> pollHits{0};
    std::atomic<uint32_t> cardsAdmitted{0};
    std::atomic<uint32_t> cardsBusy{0};
    std::atomic<uint32_t> requests{0};
    std::atomic<uint32_t> http2xx{0};
    std::atomic<uint32_t> http401403{0};
    std::atomic<uint32_t> httpOther{0};
    std::atomic<uint32_t> connErrors{0};
    std::atomic<uint32_t> lastLatencyMs{0};
    std::atomic<uint32_t> maxLatencyMs{0};
    std::atomic<uint32_t> nfcReinits{0};
    std::atomic<uint32_t> netRestarts{0};
    std::atomic<uint32_t> serverProbes{0};
};

namespace app {

// ---- status flags (written by one owner, read by all) ----
extern std::atomic<bool> linkUp;      // network events: cable / Wi-Fi association
extern std::atomic<bool> netUp;       // network events: IP address obtained
extern std::atomic<uint32_t> ipv4;    // network events: address (lwIP byte order), 0 = none
extern std::atomic<bool> serverDown;  // Net task: last connection to the server failed
extern std::atomic<bool> apMode;      // Wi-Fi build without credentials
extern std::atomic<bool> nfcReady;    // NFC task
extern std::atomic<bool> netBusy;     // set by NFC on admit, cleared by Net
extern std::atomic<bool> otaActive;   // API task
extern TerminalStats stats;

// ---- queues ----
extern QueueHandle_t uidQueue;  // NFC -> Net, depth 1
extern QueueHandle_t uiQueue;   // any -> UI

// ---- task handles (for diagnostics) ----
extern TaskHandle_t hNfc, hNet, hUi, hApi, hSys;

void initState();

// ---- configuration (guarded by a mutex) ----
TerminalConfig config();
void setConfig(const TerminalConfig &cfg);
bool isConfigured();

// ---- provisioning window and auth throttle (guarded) ----
void provOpen();
bool provIsOpen();
bool provCode(char out[prov::OTP_DIGITS + 1], uint32_t &remainingMs);
prov::OtpWindow::Check provCheck(const char *otp, size_t n);
void provClose();
bool authAllowed();
void authFailure();
void authSuccess();

// ---- UI ----
void uiShow(Icon icon, const char *text, uint16_t holdMs);

// ---- identity / network info ----
String serialNumber();
String uniqueNumber();
String ipString();
const char *networkType();

// ---- restart scheduling (executed by the Sys task) ----
void scheduleRestart(uint32_t delayMs);
bool restartDue();

}  // namespace app

// ---- module entry points ----
bool storageLoad(TerminalConfig &cfg);
bool storageSave(const TerminalConfig &cfg);
void storageClear();
bool storageMigrateLegacy(TerminalConfig &cfg);

void networkBegin(const TerminalConfig &cfg);
void networkSupervise();  // Net task, while idle

void uiHardwareInit();
void uiTask(void *);
void nfcTask(void *);
void netTask(void *);
void apiTask(void *);
void sysTask(void *);
