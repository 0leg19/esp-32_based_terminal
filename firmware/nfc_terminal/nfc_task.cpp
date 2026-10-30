// nfc_task.cpp - PN532 polling and the UID-aware card latch, owned
// exclusively by the NFC task (firmware 1.1.0).

#include "app_state.h"

#include <Adafruit_PN532.h>
#include <Wire.h>
#include <esp_task_wdt.h>

static Adafruit_PN532 nfc(PIN_PN532_IRQ, PIN_PN532_RESET, &Wire);
static CardLatch latch;

static void scanI2C() {
    for (uint8_t address = 1; address < 127; address++) {
        Wire.beginTransmission(address);
        if (Wire.endTransmission() == 0) {
            Serial.printf("[NFC] I2C device at 0x%02X\n", address);
        }
    }
}

static bool initializePN532() {
    nfc.begin();
    const uint32_t version = nfc.getFirmwareVersion();
    if (version == 0) {
        Serial.println("[NFC] PN532 not found");
        return false;
    }
    Serial.printf("[NFC] PN5%02X firmware %u.%u\n",
                  static_cast<unsigned>((version >> 24) & 0xFF),
                  static_cast<unsigned>((version >> 16) & 0xFF),
                  static_cast<unsigned>((version >> 8) & 0xFF));
    if (!nfc.SAMConfig()) {
        Serial.println("[NFC] SAMConfig failed");
        return false;
    }
    return true;
}

static bool readerShouldPoll() {
    return app::nfcReady && app::netUp && app::isConfigured() && !app::otaActive;
}

void nfcTask(void *) {
    esp_task_wdt_add(nullptr);

    Wire.begin(PIN_PN532_SDA, PIN_PN532_SCL);
    Wire.setClock(100000);
    scanI2C();

    app::nfcReady = initializePN532();
    uint32_t lastInitAttempt = millis();
    uint32_t lastHealthCheck = millis();

    for (;;) {
        esp_task_wdt_reset();
        const uint32_t now = millis();

        if (!app::nfcReady) {
            if (now - lastInitAttempt >= NFC_RETRY_INTERVAL_MS) {
                lastInitAttempt = now;
                app::stats.nfcReinits++;
                app::nfcReady = initializePN532();
                if (app::nfcReady) cardLatchReset(latch);
            }
            vTaskDelay(pdMS_TO_TICKS(100));
            continue;
        }

        if (!readerShouldPoll()) {
            vTaskDelay(pdMS_TO_TICKS(100));
            continue;
        }

        // Periodic liveness check while no card is latched; a hung PN532
        // is re-initialised instead of silently returning "no card".
        if (!latch.latched && now - lastHealthCheck >= NFC_HEALTH_INTERVAL_MS) {
            lastHealthCheck = now;
            if (nfc.getFirmwareVersion() == 0) {
                Serial.println("[NFC] PN532 stopped responding");
                app::nfcReady = false;
                lastInitAttempt = now;
                continue;
            }
        }

        uint8_t uid[CARD_LATCH_MAX_UID] = {0};
        uint8_t uidLength = 0;
        const uint32_t t0 = micros();
        const bool detected = nfc.readPassiveTargetID(
            PN532_MIFARE_ISO14443A, uid, &uidLength, NFC_POLL_TIMEOUT_MS);
        const uint32_t pollUs = micros() - t0;

        app::stats.polls++;
        if (detected) app::stats.pollHits++;
#if MEASURE_LOG
        Serial.printf("M,%lu,poll,%d,%lu,%d\n", static_cast<unsigned long>(millis()),
                      detected ? 1 : 0, static_cast<unsigned long>(pollUs),
                      latch.latched ? 1 : 0);
#else
        (void)pollUs;
#endif

        const LatchAction action = cardLatchStep(
            latch, detected, detected ? uid : nullptr, detected ? uidLength : 0,
            CARD_MISS_THRESHOLD);

        if (action == LatchAction::Process) {
            // One request in flight at a time (uidQueue depth 1). If the Net
            // task is still busy, say so instead of showing "Ready".
            if (app::netBusy.load()) {
                app::stats.cardsBusy++;
                app::uiShow(Icon::Unknown, "Busy - tap again", BUSY_HOLD_MS);
            } else {
                CardEvent ev{};
                memcpy(ev.uid, uid, uidLength);
                ev.uidLength = uidLength;
                ev.detectedMs = millis();
                app::netBusy = true;
                if (xQueueSend(app::uidQueue, &ev, 0) == pdTRUE) {
                    app::stats.cardsAdmitted++;
                    app::uiShow(Icon::Waiting, "Checking access...", WAITING_HOLD_MS);
                } else {
                    app::netBusy = false;
                    app::stats.cardsBusy++;
                    app::uiShow(Icon::Unknown, "Busy - tap again", BUSY_HOLD_MS);
                }
            }
        }

        vTaskDelay(pdMS_TO_TICKS(5));
    }
}
