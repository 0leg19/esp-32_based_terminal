// net_task.cpp - outbound check_card requests, owned exclusively by the
// Net task (firmware 1.1.0). A slow server blocks only this task.
//
// TLS: the server certificate is always verified. If a CA certificate was
// provisioned (ca_cert), it is used as the trust anchor (pinning to a
// private CA); otherwise the ESP-IDF built-in Mozilla CA bundle is used.
// setInsecure() is not used anywhere.

#include "app_state.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <NetworkClient.h>
#include <NetworkClientSecure.h>
#include <esp_task_wdt.h>

static void uidToHex(const uint8_t *uid, uint8_t len, char *out, size_t cap) {
    static const char HEX_DIGITS[] = "0123456789ABCDEF";
    size_t o = 0;
    for (uint8_t i = 0; i < len && o + 2 < cap; i++) {
        out[o++] = HEX_DIGITS[uid[i] >> 4];
        out[o++] = HEX_DIGITS[uid[i] & 0x0F];
    }
    out[o] = '\0';
}

static void showServerMessage(Icon icon, const String &payload, const char *fallback) {
    char text[77];
    JsonDocument doc;
    const char *message = nullptr;
    if (!deserializeJson(doc, payload)) {
        message = doc["message"];
    }
    if (message != nullptr && message[0] != '\0') {
        prov::sanitizeAscii(message, strlen(message), text, sizeof(text));
    } else {
        strlcpy(text, fallback, sizeof(text));
    }
    app::uiShow(icon, text, RESULT_HOLD_MS);
}

static void performCheck(const CardEvent &ev) {
    const TerminalConfig cfg = app::config();

    if (!app::netUp) {
        app::uiShow(Icon::NoInternet, "No Network", RESULT_HOLD_MS);
        return;
    }
    if (cfg.url.length() == 0) {
        app::uiShow(Icon::NoServer, "No API URL", RESULT_HOLD_MS);
        return;
    }

    const bool https = cfg.url.startsWith("https://");
#if !ALLOW_PLAIN_HTTP
    if (!https) {
        // E.g. a plain-http URL migrated from 1.0.x: refuse to send secrets.
        app::uiShow(Icon::NoServer, "HTTPS required - reconfigure", RESULT_HOLD_MS);
        return;
    }
#endif

    char uidHex[2 * CARD_LATCH_MAX_UID + 1];
    uidToHex(ev.uid, ev.uidLength, uidHex, sizeof(uidHex));

    JsonDocument req;
    req["action"] = "check_card";
    req["uid"] = uidHex;
    String body;
    serializeJson(req, body);

    HTTPClient http;
    NetworkClient plainClient;
    NetworkClientSecure secureClient;
    bool begun;
    if (https) {
        if (cfg.caCert.length() > 0) {
            secureClient.setCACert(cfg.caCert.c_str());  // cfg outlives the request
        } else {
            secureClient.useBuiltinCACertBundle();
        }
        secureClient.setHandshakeTimeout(TLS_HANDSHAKE_TIMEOUT_S);
        begun = http.begin(secureClient, cfg.url);
    } else {
        begun = http.begin(plainClient, cfg.url);
    }
    if (!begun) {
        app::uiShow(Icon::NoServer, "Invalid API URL", RESULT_HOLD_MS);
        return;
    }

    http.setConnectTimeout(HTTP_TIMEOUT_MS);
    http.setTimeout(HTTP_TIMEOUT_MS);
    http.setReuse(false);
    http.addHeader("Content-Type", "application/json");
    if (cfg.apiKey.length() > 0) http.addHeader("x-api-key", cfg.apiKey);
    if (cfg.barrier.length() > 0) http.addHeader("Authorization", cfg.barrier);

    Serial.printf("[NET] check_card %s\n", uidHex);
    const uint32_t t0 = millis();
    const int code = http.POST(body);
    const uint32_t latency = millis() - t0;

    app::stats.requests++;
    app::stats.lastLatencyMs = latency;
    if (latency > app::stats.maxLatencyMs) app::stats.maxLatencyMs = latency;
#if MEASURE_LOG
    Serial.printf("M,%lu,req,%d,%lu,%lu\n", static_cast<unsigned long>(millis()), code,
                  static_cast<unsigned long>(latency),
                  static_cast<unsigned long>(millis() - ev.detectedMs));
#endif

    if (code > 0) {
        app::serverDown = false;
        const String payload = http.getString();
        if (code == HTTP_CODE_OK) {
            app::stats.http2xx++;
            showServerMessage(Icon::Success, payload, "Access Granted");
        } else if (code == HTTP_CODE_UNAUTHORIZED || code == HTTP_CODE_FORBIDDEN) {
            app::stats.http401403++;
            showServerMessage(Icon::Fail, payload, "Access Denied");
        } else {
            app::stats.httpOther++;
            char fallback[32];
            snprintf(fallback, sizeof(fallback), "Server Error (%d)", code);
            showServerMessage(Icon::NoServer, payload, fallback);
        }
    } else {
        app::stats.connErrors++;
        char tlsError[96] = "";
        // A failed TCP connect or DNS lookup is reported as -1 (or as a
        // small MBEDTLS_ERR_NET_* code); TLS / X.509 errors are <= -0x1000.
        if (https && secureClient.lastError(tlsError, sizeof(tlsError)) <= -0x1000) {
            Serial.printf("[NET] TLS error: %s\n", tlsError);
            app::uiShow(Icon::NoServer, "TLS Error (certificate?)", RESULT_HOLD_MS);
        } else {
            Serial.printf("[NET] connection failed: %s\n", HTTPClient::errorToString(code).c_str());
            app::serverDown = true;
            app::uiShow(Icon::NoServer, "Connection Error", RESULT_HOLD_MS);
        }
    }
    http.end();
}

// "https://host:port/path" -> host, port. False if the URL has no host.
static bool urlHostPort(const String &url, String &host, uint16_t &port) {
    const bool https = url.startsWith("https://");
    if (!https && !url.startsWith("http://")) return false;
    const int start = https ? 8 : 7;
    int end = url.indexOf('/', start);
    if (end < 0) end = url.length();
    String authority = url.substring(start, end);
    const int at = authority.lastIndexOf('@');
    if (at >= 0) authority = authority.substring(at + 1);
    port = https ? 443 : 80;
    const int colon = authority.lastIndexOf(':');
    if (colon >= 0) {
        const long p = authority.substring(colon + 1).toInt();
        if (p <= 0 || p > 65535) return false;
        port = static_cast<uint16_t>(p);
        authority = authority.substring(0, colon);
    }
    host = authority;
    return host.length() > 0;
}

// While the server is marked unreachable, try a plain TCP connect to it
// every SERVER_RETRY_MS (no HTTP request, nothing is logged as a card
// check). The first answer clears the "Server unreachable" screen.
static void probeServer() {
    static uint32_t lastProbe = 0;
    if (!app::serverDown || !app::netUp) return;
    const uint32_t now = millis();
    if (lastProbe != 0 && now - lastProbe < SERVER_RETRY_MS) return;
    lastProbe = now;

    String host;
    uint16_t port;
    if (!urlHostPort(app::config().url, host, port)) {
        app::serverDown = false;  // nothing to probe; "No API URL" is shown on a tap
        return;
    }
    app::stats.serverProbes++;
    esp_task_wdt_reset();
    NetworkClient client;
    if (client.connect(host.c_str(), port, SERVER_PROBE_TIMEOUT_MS)) {
        client.stop();
        app::serverDown = false;
        Serial.printf("[NET] server %s:%u reachable again\n", host.c_str(), port);
    } else {
        Serial.printf("[NET] server %s:%u still unreachable\n", host.c_str(), port);
    }
}

void netTask(void *) {
    esp_task_wdt_add(nullptr);
    CardEvent ev;
    for (;;) {
        esp_task_wdt_reset();
        if (xQueueReceive(app::uidQueue, &ev, pdMS_TO_TICKS(1000)) != pdTRUE) {
            networkSupervise();
            probeServer();
            continue;
        }
        performCheck(ev);
        app::netBusy = false;
    }
}
