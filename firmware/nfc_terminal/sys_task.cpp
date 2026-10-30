// sys_task.cpp - BOOT button gestures and scheduled restarts
// (firmware 1.1.0).
//
//   short press (50 ms .. 2 s) : open the provisioning window and show a
//                                one-time code on the display (120 s)
//   hold 5 s                   : factory reset (erase configuration)
//
// Gestures are detected at run time only: holding GPIO0 while the chip
// leaves reset starts the ROM bootloader instead of the firmware.

#include "app_state.h"

#include <esp_task_wdt.h>

void sysTask(void *) {
    esp_task_wdt_add(nullptr);
    pinMode(PIN_BOOT_BUTTON, INPUT_PULLUP);

    // Ignore a press that is already in progress when the task starts.
    bool pressed = digitalRead(PIN_BOOT_BUTTON) == LOW;
    bool armed = !pressed;
    bool hintShown = false;
    uint32_t pressedAt = millis();

    for (;;) {
        esp_task_wdt_reset();
        const uint32_t now = millis();
        const bool low = digitalRead(PIN_BOOT_BUTTON) == LOW;

        if (low && !pressed) {
            pressed = true;
            pressedAt = now;
            hintShown = false;
        } else if (low && pressed && armed) {
            const uint32_t held = now - pressedAt;
            if (held >= BUTTON_HINT_MS && !hintShown) {
                hintShown = true;
                app::uiShow(Icon::Unknown, "Keep holding: factory reset", 3500);
            }
            if (held >= BUTTON_FACTORY_RESET_MS) {
                Serial.println("[SYS] factory reset");
                storageClear();
                app::uiShow(Icon::Progress, "Factory reset - restarting", 2000);
                vTaskDelay(pdMS_TO_TICKS(1000));
                ESP.restart();
            }
        } else if (!low && pressed) {
            const uint32_t held = now - pressedAt;
            pressed = false;
            if (armed && held >= BUTTON_DEBOUNCE_MS && held < BUTTON_HINT_MS) {
                app::provOpen();
                Serial.println("[SYS] provisioning window opened (code on display)");
            }
            armed = true;
        }

        if (app::restartDue()) {
            Serial.println("[SYS] restarting");
            vTaskDelay(pdMS_TO_TICKS(100));
            ESP.restart();
        }

        vTaskDelay(pdMS_TO_TICKS(20));
    }
}
