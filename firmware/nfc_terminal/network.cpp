// network.cpp - W5500 Ethernet or Wi-Fi bring-up and recovery
// (firmware 1.1.0).
//
// The network drivers run in their own ESP-IDF tasks; this module starts
// them and mirrors link and address state into app::linkUp / app::netUp /
// app::ipv4 via events. A cable plugged in later is picked up by the
// driver's link polling, followed by DHCP. networkSupervise() (Net task)
// restarts the W5500 when no address is obtained, so a module that failed
// to start or hung is recovered without a reboot.

#include "app_state.h"

#include <Network.h>

#if USE_W5500
#include <ETH.h>
#include <SPI.h>

// W5500 on the HSPI peripheral; the display owns VSPI (defect D1 of 1.0.0).
static SPIClass ethSPI(HSPI);
#else
#include <WiFi.h>
#endif

static void markDown() {
    app::netUp = false;
    app::ipv4 = 0;
}

static void onNetworkEvent(arduino_event_id_t event, arduino_event_info_t info) {
    switch (event) {
#if USE_W5500
        case ARDUINO_EVENT_ETH_START:
            ETH.setHostname("esp32-rfid");
            Serial.println("[ETH] started");
            break;
        case ARDUINO_EVENT_ETH_CONNECTED:
            Serial.println("[ETH] link up");
            app::linkUp = true;
            break;
        case ARDUINO_EVENT_ETH_GOT_IP:
            app::ipv4 = info.got_ip.ip_info.ip.addr;
            app::netUp = true;
            Serial.printf("[ETH] IP %s\n", app::ipString().c_str());
            break;
        case ARDUINO_EVENT_ETH_LOST_IP:
            Serial.println("[ETH] lost IP");
            markDown();
            break;
        case ARDUINO_EVENT_ETH_DISCONNECTED:
            Serial.println("[ETH] link down (cable?)");
            app::linkUp = false;
            markDown();
            break;
        case ARDUINO_EVENT_ETH_STOP:
            Serial.println("[ETH] stopped");
            app::linkUp = false;
            markDown();
            break;
#else
        case ARDUINO_EVENT_WIFI_STA_CONNECTED:
            app::linkUp = true;
            break;
        case ARDUINO_EVENT_WIFI_STA_GOT_IP:
            app::ipv4 = info.got_ip.ip_info.ip.addr;
            app::netUp = true;
            Serial.printf("[WIFI] IP %s\n", WiFi.localIP().toString().c_str());
            break;
        case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
            app::linkUp = false;
            markDown();
            break;
        case ARDUINO_EVENT_WIFI_STA_LOST_IP:
            markDown();
            break;
#endif
        default:
            break;
    }
}

#if USE_W5500
static bool ethStart() {
    pinMode(PIN_W5500_RST, OUTPUT);
    digitalWrite(PIN_W5500_RST, LOW);
    delay(100);
    digitalWrite(PIN_W5500_RST, HIGH);
    delay(250);

    if (!ETH.begin(ETH_PHY_W5500, 1, PIN_W5500_CS, PIN_W5500_INT, PIN_W5500_RST, ethSPI)) {
        Serial.println("[ETH] ETH.begin() failed");
        return false;
    }
    return true;
}
#endif

void networkBegin(const TerminalConfig &cfg) {
    Network.onEvent(onNetworkEvent);

#if USE_W5500
    (void)cfg;
    ethSPI.begin(PIN_W5500_SCK, PIN_W5500_MISO, PIN_W5500_MOSI, PIN_W5500_CS);
    ethStart();
#else
    if (cfg.wifiSsid.length() > 0) {
        WiFi.mode(WIFI_STA);
        WiFi.persistent(false);
        WiFi.setAutoReconnect(true);
        WiFi.begin(cfg.wifiSsid.c_str(),
                   cfg.wifiPass.length() ? cfg.wifiPass.c_str() : nullptr);
        Serial.printf("[WIFI] connecting to %s\n", cfg.wifiSsid.c_str());
    } else {
        // No credentials in source code: open a setup access point. Joining
        // it is harmless, because /connect still requires the one-time
        // code that is shown only on the terminal's own display.
        uint8_t mac[6];
        WiFi.macAddress(mac);
        char ssid[20];
        snprintf(ssid, sizeof(ssid), "NFC-Setup-%02X%02X", mac[4], mac[5]);
        WiFi.mode(WIFI_AP);
        WiFi.softAP(ssid);
        app::apMode = true;
        Serial.printf("[WIFI] setup AP %s at %s\n", ssid, WiFi.softAPIP().toString().c_str());
    }
#endif
}

// Called by the Net task about once per second while no request is in
// flight, so a restart never interrupts a check_card request. Wi-Fi
// reconnects on its own (setAutoReconnect).
void networkSupervise() {
#if USE_W5500
    static uint32_t waitSince = millis();       // start of the current wait for an address
    static uint32_t serverDownSince = 0;
    static bool lastLink = false;

    const uint32_t now = millis();
    const bool link = app::linkUp.load();
    bool restart = false;

    if (app::netUp) {
        waitSince = now;
        if (!app::serverDown) {
            serverDownSince = 0;
        } else if (serverDownSince == 0) {
            serverDownSince = now;
        } else if (now - serverDownSince >= NET_STALL_RESTART_MS) {
            // Link and address look fine, but nothing gets through: a
            // stalled W5500 keeps both until the DHCP lease runs out.
            Serial.println("[ETH] server unreachable for a long time, restarting W5500");
            serverDownSince = now;
            restart = true;
        }
    } else {
        serverDownSince = 0;
        if (link && !lastLink) waitSince = now;  // cable plugged in: give DHCP a full interval
        if (now - waitSince >= NET_RECOVERY_MS) {
            Serial.printf("[ETH] no IP for %lus (%s), restarting W5500\n",
                          static_cast<unsigned long>((now - waitSince) / 1000),
                          link ? "link up, no DHCP answer" : "no link");
            waitSince = now;
            restart = true;
        }
    }
    lastLink = link;

    if (restart) {
        app::stats.netRestarts++;
        ETH.end();
        ethStart();
    }
#endif
}
