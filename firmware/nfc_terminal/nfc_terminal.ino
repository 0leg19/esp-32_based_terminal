// nfc_terminal.ino - standalone ESP32 NFC terminal, firmware 1.1.0.
//
// FreeRTOS architecture: five tasks, each the single owner of its driver,
// communicating only through queues and guarded accessors (app_state.h).
//
//   core 1: NFC (prio 4)  PN532 polling + UID-aware latch
//           UI  (prio 3)  ILI9341 + RGB LED, non-blocking hold timers
//   core 0: Net (prio 2)  check_card over HTTPS (verified certificates)
//           API (prio 2)  GET /, POST /connect, GET /diag, POST /ota
//           Sys (prio 1)  BOOT button gestures, scheduled restart
//
// Wiring is identical to firmware 1.0.1 (see config.h).

#include "app_state.h"

#include <esp_task_wdt.h>

static void configureWatchdog() {
    // The Net task may legitimately block for connect + TLS handshake +
    // response; 30 s covers that with margin. A hung task still resets
    // the device.
    esp_task_wdt_config_t wdt = {
        .timeout_ms = WDT_TIMEOUT_MS,
        .idle_core_mask = 0,
        .trigger_panic = true,
    };
    if (esp_task_wdt_reconfigure(&wdt) != ESP_OK) {
        esp_task_wdt_init(&wdt);
    }
}

static TaskHandle_t startTask(TaskFunction_t fn, const char *name, uint32_t stack,
                              UBaseType_t prio, BaseType_t core) {
    TaskHandle_t handle = nullptr;
    if (xTaskCreatePinnedToCore(fn, name, stack, nullptr, prio, &handle, core) != pdPASS) {
        Serial.printf("[BOOT] failed to start task %s\n", name);
    }
    return handle;
}

void setup() {
    Serial.begin(115200);
    delay(200);
    Serial.printf("\n[BOOT] %s %s, serial %s\n", MODEL, SOFTWARE_VERSION,
                  app::serialNumber().c_str());

    app::initState();
    uiHardwareInit();

    TerminalConfig cfg;
    if (!storageLoad(cfg) || !cfg.configured) {
        storageMigrateLegacy(cfg);  // one-time upgrade path from 1.0.x
    }
    app::setConfig(cfg);
    Serial.printf("[BOOT] configuration: %s\n", cfg.configured ? "present" : "none");

    networkBegin(cfg);
    configureWatchdog();

    app::hUi  = startTask(uiTask,  "ui",  UI_TASK_STACK,  UI_TASK_PRIO,  UI_TASK_CORE);
    app::hNfc = startTask(nfcTask, "nfc", NFC_TASK_STACK, NFC_TASK_PRIO, NFC_TASK_CORE);
    app::hNet = startTask(netTask, "net", NET_TASK_STACK, NET_TASK_PRIO, NET_TASK_CORE);
    app::hApi = startTask(apiTask, "api", API_TASK_STACK, API_TASK_PRIO, API_TASK_CORE);
    app::hSys = startTask(sysTask, "sys", SYS_TASK_STACK, SYS_TASK_PRIO, SYS_TASK_CORE);
}

void loop() {
    // All work happens in the tasks above; the Arduino loop task is not needed.
    vTaskDelete(nullptr);
}
