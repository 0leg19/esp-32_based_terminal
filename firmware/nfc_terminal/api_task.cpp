// api_task.cpp - local HTTP API on port 80, owned exclusively by the API
// task (firmware 1.1.0). Stays responsive while the Net task waits for
// the server.
//
//   GET  /         identity and state (discovery)
//   POST /connect  provisioning; requires the current barrier
//                  (Authorization header) or the one-time code shown on
//                  the display after a short BOOT press (field "otp")
//   GET  /diag     counters, heap and task stack margins (barrier)
//   POST /ota      signed firmware update (barrier + X-Signature)

#include "app_state.h"

#include <ArduinoJson.h>
#include <Update.h>
#include <WebServer.h>
#include <esp_task_wdt.h>
#include <mbedtls/pk.h>
#include <mbedtls/sha256.h>

// ECDSA P-256 public key (PEM) used to verify OTA images. Leave empty to
// disable /ota. Generate the key pair once and keep the private key off the
// device (see README):
//   openssl ecparam -name prime256v1 -genkey -noout -out ota_private.pem
//   openssl ec -in ota_private.pem -pubout -out ota_public.pem
static const char OTA_PUBLIC_KEY_PEM[] = "";

static WebServer server(80);
static const char *COLLECTED_HEADERS[] = {"Authorization", "X-Signature"};

// ============================================================
// HELPERS
// ============================================================

static void sendJson(int code, JsonDocument &doc) {
    String out;
    serializeJson(doc, out);
    server.send(code, "application/json", out);
}

static void sendError(int code, const char *message) {
    JsonDocument doc;
    doc["status"] = "error";
    doc["message"] = message;
    sendJson(code, doc);
}

enum class Auth : uint8_t { Ok, Missing, Wrong, Throttled, NotConfigured };

// Authorization header must equal the current barrier.
static Auth checkBarrier() {
    if (!app::authAllowed()) return Auth::Throttled;
    const TerminalConfig cfg = app::config();
    if (!cfg.configured || cfg.barrier.length() == 0) return Auth::NotConfigured;
    if (!server.hasHeader("Authorization")) return Auth::Missing;
    const String header = server.header("Authorization");
    if (header.length() == 0) return Auth::Missing;
    if (prov::ctEquals(header.c_str(), header.length(),
                       cfg.barrier.c_str(), cfg.barrier.length())) {
        app::authSuccess();
        return Auth::Ok;
    }
    app::authFailure();
    return Auth::Wrong;
}

static bool requireBarrier() {
    switch (checkBarrier()) {
        case Auth::Ok:            return true;
        case Auth::Throttled:     sendError(429, "too many failed attempts, retry later"); return false;
        case Auth::NotConfigured: sendError(403, "device is not configured"); return false;
        case Auth::Missing:       sendError(401, "Authorization required"); return false;
        case Auth::Wrong:         sendError(401, "invalid Authorization"); return false;
    }
    return false;
}

static prov::Field fieldOf(JsonDocument &doc, const char *key) {
    const char *v = doc[key] | "";
    return prov::Field{v, strlen(v)};
}

// ============================================================
// GET /
// ============================================================

static void handleRoot() {
    JsonDocument doc;
    doc["creator"] = CREATOR;
    doc["serial_number"] = app::serialNumber();
    doc["software_version"] = SOFTWARE_VERSION;
    doc["model"] = MODEL;
    doc["display"] = MODEL;
    doc["unique_number"] = app::uniqueNumber();  // per-chip identifier, not a secret
    doc["ip_address"] = app::ipString();
    doc["connection"] = (app::netUp || app::apMode) ? app::networkType() : "none";
    doc["nfc_status"] = app::nfcReady ? "ready" : "error";
    doc["connection_status"] = app::isConfigured() ? "connected" : "not connected";
    doc["provisioning"] = app::provIsOpen() ? "open" : "closed";
    sendJson(200, doc);
}

// ============================================================
// POST /connect
// ============================================================

static void handleConnect() {
    if (!server.hasArg("plain")) {
        sendError(400, "Missing JSON body");
        return;
    }
    const String &raw = server.arg("plain");
    if (raw.length() > MAX_CONNECT_BODY) {
        sendError(413, "body too large");
        return;
    }
    JsonDocument doc;
    if (deserializeJson(doc, raw)) {
        sendError(400, "invalid_json");
        return;
    }
    if (!app::authAllowed()) {
        sendError(429, "too many failed attempts, retry later");
        return;
    }

    // 1) Authorisation: current barrier, or one-time code from the display.
    bool authorised = false;
    if (server.hasHeader("Authorization") && server.header("Authorization").length() > 0) {
        authorised = checkBarrier() == Auth::Ok;
    }
    if (!authorised) {
        const char *otp = doc["otp"] | "";
        if (otp[0] == '\0') {
            sendError(401, "press the BOOT button and send the code shown on the display as \"otp\"");
            return;
        }
        switch (app::provCheck(otp, strlen(otp))) {
            case prov::OtpWindow::Check::Ok:
                authorised = true;
                break;
            case prov::OtpWindow::Check::Closed:
                sendError(403, "provisioning window is closed; press BOOT");
                return;
            case prov::OtpWindow::Check::Wrong:
                app::authFailure();
                sendError(401, "wrong code");
                return;
            case prov::OtpWindow::Check::Locked:
                app::authFailure();
                sendError(403, "too many wrong codes; press BOOT again");
                return;
        }
    }

    // 2) Validation.
    const TerminalConfig current = app::config();
    prov::Input in{};
    in.url = fieldOf(doc, "url");
    in.apiKey = fieldOf(doc, "api_key");
    in.barrier = fieldOf(doc, "barrier");
    in.caCert = fieldOf(doc, "ca_cert");
    in.wifiSsid = fieldOf(doc, "wifi_ssid");
    in.wifiPass = fieldOf(doc, "wifi_password");

    const prov::Err err = prov::validate(in, ALLOW_PLAIN_HTTP != 0);
    if (err != prov::Err::Ok) {
        sendError(400, prov::errMessage(err));
        return;
    }
#if !USE_W5500
    if (current.wifiSsid.length() == 0 && in.wifiSsid.n == 0) {
        sendError(400, "wifi_ssid is required for the Wi-Fi build");
        return;
    }
#endif

    // 3) Apply. Absent optional fields keep their stored values.
    TerminalConfig next = current;
    next.url = String(in.url.p);
    next.apiKey = String(in.apiKey.p);
    next.barrier = String(in.barrier.p);
    if (!doc["ca_cert"].isNull()) next.caCert = String(in.caCert.p);
    bool wifiChanged = false;
    if (in.wifiSsid.n > 0) {
        wifiChanged = next.wifiSsid != in.wifiSsid.p || next.wifiPass != in.wifiPass.p;
        next.wifiSsid = String(in.wifiSsid.p);
        next.wifiPass = String(in.wifiPass.p);
    }
    next.configured = true;

    if (!storageSave(next)) {
        sendError(500, "storage write failed");
        return;
    }
    app::setConfig(next);
    app::provClose();
    app::authSuccess();

    const bool restart = (USE_W5500 == 0) && wifiChanged;
    JsonDocument ok;
    ok["status"] = "success";
    ok["restart"] = restart;
    sendJson(200, ok);

    Serial.println("[API] configuration updated");
    if (restart) app::scheduleRestart(RESTART_DELAY_MS);
}

// ============================================================
// GET /diag
// ============================================================

static void addTask(JsonObject tasks, const char *name, TaskHandle_t h) {
    if (h != nullptr) tasks[name] = uxTaskGetStackHighWaterMark(h);  // bytes left
}

static void handleDiag() {
    if (!requireBarrier()) return;
    JsonDocument doc;
    doc["software_version"] = SOFTWARE_VERSION;
    doc["uptime_s"] = millis() / 1000;
    doc["heap_free"] = ESP.getFreeHeap();
    doc["heap_min_free"] = ESP.getMinFreeHeap();
    doc["latch_k"] = CARD_MISS_THRESHOLD;
    doc["link_up"] = app::linkUp.load();
    doc["net_up"] = app::netUp.load();
    doc["server_reachable"] = !app::serverDown.load();
    JsonObject tasks = doc["stack_free_bytes"].to<JsonObject>();
    addTask(tasks, "nfc", app::hNfc);
    addTask(tasks, "net", app::hNet);
    addTask(tasks, "ui", app::hUi);
    addTask(tasks, "api", app::hApi);
    addTask(tasks, "sys", app::hSys);
    JsonObject s = doc["stats"].to<JsonObject>();
    s["polls"] = app::stats.polls.load();
    s["poll_hits"] = app::stats.pollHits.load();
    s["cards_admitted"] = app::stats.cardsAdmitted.load();
    s["cards_busy"] = app::stats.cardsBusy.load();
    s["requests"] = app::stats.requests.load();
    s["http_200"] = app::stats.http2xx.load();
    s["http_401_403"] = app::stats.http401403.load();
    s["http_other"] = app::stats.httpOther.load();
    s["conn_errors"] = app::stats.connErrors.load();
    s["last_latency_ms"] = app::stats.lastLatencyMs.load();
    s["max_latency_ms"] = app::stats.maxLatencyMs.load();
    s["nfc_reinits"] = app::stats.nfcReinits.load();
    s["net_restarts"] = app::stats.netRestarts.load();
    s["server_probes"] = app::stats.serverProbes.load();
    sendJson(200, doc);
}

// ============================================================
// POST /ota  (multipart field "firmware"; header X-Signature = hex of the
//             DER-encoded ECDSA P-256 / SHA-256 signature of the image)
// ============================================================

struct OtaSession {
    bool authorised = false;
    bool writing = false;
    bool success = false;
    int status = 500;
    String error;
    uint8_t signature[80];
    int signatureLen = 0;
    size_t bytes = 0;
    mbedtls_sha256_context sha;
};
static OtaSession ota;

static void otaFail(int status, const char *message) {
    if (ota.writing) {
        Update.abort();
        mbedtls_sha256_free(&ota.sha);
    }
    ota.writing = false;
    ota.success = false;
    ota.status = status;
    if (ota.error.length() == 0) ota.error = message;
    app::otaActive = false;
}

static bool otaVerifySignature(const uint8_t digest[32]) {
    mbedtls_pk_context pk;
    mbedtls_pk_init(&pk);
    bool ok = mbedtls_pk_parse_public_key(
                  &pk, reinterpret_cast<const unsigned char *>(OTA_PUBLIC_KEY_PEM),
                  sizeof(OTA_PUBLIC_KEY_PEM)) == 0 &&
              mbedtls_pk_can_do(&pk, MBEDTLS_PK_ECKEY) &&
              mbedtls_pk_verify(&pk, MBEDTLS_MD_SHA256, digest, 32,
                                ota.signature, static_cast<size_t>(ota.signatureLen)) == 0;
    mbedtls_pk_free(&pk);
    return ok;
}

static void handleOtaUpload() {
    HTTPUpload &up = server.upload();
    esp_task_wdt_reset();

    if (up.status == UPLOAD_FILE_START) {
        ota = OtaSession();
        if (sizeof(OTA_PUBLIC_KEY_PEM) <= 1) {
            otaFail(501, "OTA disabled: no public key in this build");
            return;
        }
        const Auth auth = checkBarrier();
        if (auth != Auth::Ok) {
            otaFail(auth == Auth::Throttled ? 429 : 401, "Authorization required");
            return;
        }
        ota.authorised = true;
        const String sigHex = server.header("X-Signature");
        ota.signatureLen = prov::hexDecode(sigHex.c_str(), sigHex.length(),
                                           ota.signature, sizeof(ota.signature));
        if (ota.signatureLen <= 0) {
            otaFail(400, "X-Signature (hex DER) required");
            return;
        }
        if (!Update.begin(UPDATE_SIZE_UNKNOWN)) {
            otaFail(500, Update.errorString());
            return;
        }
        mbedtls_sha256_init(&ota.sha);
        mbedtls_sha256_starts(&ota.sha, 0);
        ota.writing = true;
        app::otaActive = true;
        Serial.println("[OTA] receiving image");
    } else if (up.status == UPLOAD_FILE_WRITE) {
        if (!ota.writing) return;
        mbedtls_sha256_update(&ota.sha, up.buf, up.currentSize);
        if (Update.write(up.buf, up.currentSize) != up.currentSize) {
            otaFail(500, Update.errorString());
            return;
        }
        ota.bytes += up.currentSize;
    } else if (up.status == UPLOAD_FILE_END) {
        if (!ota.writing) return;
        uint8_t digest[32];
        mbedtls_sha256_finish(&ota.sha, digest);
        mbedtls_sha256_free(&ota.sha);
        ota.writing = false;
        if (!otaVerifySignature(digest)) {
            Update.abort();
            otaFail(403, "signature verification failed");
            return;
        }
        if (!Update.end(true)) {
            otaFail(500, Update.errorString());
            return;
        }
        ota.success = true;
        ota.status = 200;
        Serial.printf("[OTA] verified image, %u bytes\n", static_cast<unsigned>(ota.bytes));
    } else if (up.status == UPLOAD_FILE_ABORTED) {
        otaFail(400, "upload aborted");
    }
}

static void handleOtaDone() {
    JsonDocument doc;
    if (ota.success) {
        doc["status"] = "success";
        doc["bytes"] = static_cast<uint32_t>(ota.bytes);
        sendJson(200, doc);
        app::scheduleRestart(RESTART_DELAY_MS);
    } else {
        sendError(ota.status == 200 ? 500 : ota.status,
                  ota.error.length() ? ota.error.c_str() : "no firmware received");
        app::otaActive = false;
    }
}

// ============================================================
// TASK
// ============================================================

void apiTask(void *) {
    esp_task_wdt_add(nullptr);

    server.collectHeaders(COLLECTED_HEADERS, 2);
    server.on("/", HTTP_GET, handleRoot);
    server.on("/connect", HTTP_POST, handleConnect);
    server.on("/diag", HTTP_GET, handleDiag);
    server.on("/ota", HTTP_POST, handleOtaDone, handleOtaUpload);
    server.onNotFound([]() { sendError(404, "not_found"); });
    server.begin();
    Serial.println("[API] HTTP server on port 80");

    for (;;) {
        esp_task_wdt_reset();
        server.handleClient();
        vTaskDelay(pdMS_TO_TICKS(2));
    }
}
