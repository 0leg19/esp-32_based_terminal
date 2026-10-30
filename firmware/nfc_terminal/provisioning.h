// provisioning.h - pure, host-testable security helpers (firmware 1.1.0).
//
// No Arduino or ESP-IDF dependencies: the same code is compiled into the
// firmware and into the host test (tests/provisioning_test.cpp).

#pragma once

#include <stddef.h>
#include <stdint.h>
#include <string.h>

namespace prov {

constexpr size_t MAX_URL       = 350;
constexpr size_t MAX_API_KEY   = 64;
constexpr size_t MAX_BARRIER   = 64;
constexpr size_t MAX_CA_CERT   = 3800;   // fits one NVS string entry
constexpr size_t MAX_SSID      = 32;
constexpr size_t MIN_WIFI_PASS = 8;
constexpr size_t MAX_WIFI_PASS = 63;
constexpr size_t OTP_DIGITS    = 6;

struct Field {
    const char *p;
    size_t n;
};

struct Input {
    Field url;
    Field apiKey;
    Field barrier;
    Field caCert;    // optional
    Field wifiSsid;  // optional
    Field wifiPass;  // optional
};

enum class Err : uint8_t {
    Ok,
    MissingField,
    TooLong,
    InvalidChar,
    BadScheme,
    PlainHttpBlocked,
    BadCaCert,
    BadWifi,
};

inline const char *errMessage(Err e) {
    switch (e) {
        case Err::Ok:               return "ok";
        case Err::MissingField:     return "url, api_key and barrier are required";
        case Err::TooLong:          return "url max 350, api_key max 64, barrier max 64, ca_cert max 3800 characters";
        case Err::InvalidChar:      return "control characters are not allowed; url must not contain spaces";
        case Err::BadScheme:        return "url must start with https:// (or http:// in development builds) and contain a host";
        case Err::PlainHttpBlocked: return "plain http:// is disabled in this build; use https://";
        case Err::BadCaCert:        return "ca_cert must be a PEM certificate";
        case Err::BadWifi:          return "wifi_ssid max 32; wifi_password 8-63 characters or empty";
    }
    return "invalid request";
}

inline bool startsWith(Field f, const char *prefix) {
    const size_t m = strlen(prefix);
    return f.n >= m && memcmp(f.p, prefix, m) == 0;
}

// Control characters would allow HTTP header injection when the value is
// later sent as a header (e.g. "\r\n" inside barrier).
inline bool hasControlChar(Field f, bool allowLineBreaks = false) {
    for (size_t i = 0; i < f.n; i++) {
        const unsigned char c = static_cast<unsigned char>(f.p[i]);
        if (c == 0x7F) return true;
        if (c < 0x20) {
            if (allowLineBreaks && (c == '\n' || c == '\r')) continue;
            return true;
        }
    }
    return false;
}

inline bool hasSpace(Field f) {
    for (size_t i = 0; i < f.n; i++) {
        if (f.p[i] == ' ') return true;
    }
    return false;
}

inline Err validate(const Input &in, bool allowPlainHttp) {
    if (in.url.n == 0 || in.apiKey.n == 0 || in.barrier.n == 0) return Err::MissingField;
    if (in.url.n > MAX_URL || in.apiKey.n > MAX_API_KEY ||
        in.barrier.n > MAX_BARRIER || in.caCert.n > MAX_CA_CERT) {
        return Err::TooLong;
    }
    if (hasControlChar(in.url) || hasControlChar(in.apiKey) ||
        hasControlChar(in.barrier) || hasSpace(in.url)) {
        return Err::InvalidChar;
    }

    const bool https = startsWith(in.url, "https://");
    const bool http  = startsWith(in.url, "http://");
    if (!https && !http) return Err::BadScheme;
    if ((https && in.url.n == 8) || (http && in.url.n == 7)) return Err::BadScheme;
    if (http && !allowPlainHttp) return Err::PlainHttpBlocked;

    if (in.caCert.n > 0) {
        if (!startsWith(in.caCert, "-----BEGIN CERTIFICATE-----") ||
            hasControlChar(in.caCert, true)) {
            return Err::BadCaCert;
        }
    }

    if (in.wifiSsid.n > MAX_SSID) return Err::BadWifi;
    if (in.wifiSsid.n == 0 && in.wifiPass.n > 0) return Err::BadWifi;
    if (in.wifiPass.n > 0 && (in.wifiPass.n < MIN_WIFI_PASS || in.wifiPass.n > MAX_WIFI_PASS)) {
        return Err::BadWifi;
    }
    if (hasControlChar(in.wifiSsid) || hasControlChar(in.wifiPass)) return Err::BadWifi;

    return Err::Ok;
}

// Compare secrets without an early exit on the first differing byte.
inline bool ctEquals(const char *a, size_t an, const char *b, size_t bn) {
    if (a == nullptr || b == nullptr) return false;
    uint8_t diff = static_cast<uint8_t>(an != bn);
    const size_t n = an < bn ? an : bn;
    for (size_t i = 0; i < n; i++) {
        diff |= static_cast<uint8_t>(a[i] ^ b[i]);
    }
    return diff == 0;
}

// Uniform 6-digit code from a 32-bit random source (rejection sampling).
inline uint32_t makeOtpCode(uint32_t (*random32)()) {
    constexpr uint32_t RANGE = 1000000u;
    constexpr uint32_t LIMIT = UINT32_MAX - (UINT32_MAX % RANGE);
    uint32_t r;
    do {
        r = random32();
    } while (r >= LIMIT);
    return r % RANGE;
}

inline void formatOtp(uint32_t code, char out[OTP_DIGITS + 1]) {
    for (int i = static_cast<int>(OTP_DIGITS) - 1; i >= 0; i--) {
        out[i] = static_cast<char>('0' + code % 10);
        code /= 10;
    }
    out[OTP_DIGITS] = '\0';
}

// Physical-presence provisioning window: one-time code shown on the display.
class OtpWindow {
public:
    enum class Check : uint8_t { Ok, Closed, Wrong, Locked };

    void open(uint32_t nowMs, uint32_t code, uint32_t durationMs, uint8_t maxTries) {
        open_ = true;
        openedAt_ = nowMs;
        duration_ = durationMs;
        maxTries_ = maxTries == 0 ? 1 : maxTries;
        tries_ = 0;
        formatOtp(code % 1000000u, code_);
    }

    void close() {
        open_ = false;
        memset(code_, 0, sizeof(code_));
    }

    bool isOpen(uint32_t nowMs) const {
        return open_ && static_cast<uint32_t>(nowMs - openedAt_) < duration_;
    }

    uint32_t remainingMs(uint32_t nowMs) const {
        return isOpen(nowMs) ? duration_ - static_cast<uint32_t>(nowMs - openedAt_) : 0;
    }

    const char *code() const { return code_; }

    Check check(const char *otp, size_t n, uint32_t nowMs) {
        if (!isOpen(nowMs)) {
            close();
            return Check::Closed;
        }
        bool digits = (otp != nullptr && n == OTP_DIGITS);
        for (size_t i = 0; digits && i < n; i++) {
            digits = otp[i] >= '0' && otp[i] <= '9';
        }
        if (digits && ctEquals(otp, n, code_, OTP_DIGITS)) {
            close();
            return Check::Ok;
        }
        tries_++;
        if (tries_ >= maxTries_) {
            close();
            return Check::Locked;
        }
        return Check::Wrong;
    }

private:
    bool open_ = false;
    uint32_t openedAt_ = 0;
    uint32_t duration_ = 0;
    uint8_t maxTries_ = 1;
    uint8_t tries_ = 0;
    char code_[OTP_DIGITS + 1] = {0};
};

// Lock-out after repeated authentication failures (barrier or OTA).
class AuthThrottle {
public:
    AuthThrottle(uint8_t maxFailures, uint32_t lockoutMs)
        : max_(maxFailures == 0 ? 1 : maxFailures), lockout_(lockoutMs) {}

    bool allowed(uint32_t nowMs) {
        if (locked_ && static_cast<uint32_t>(nowMs - lockedAt_) >= lockout_) {
            locked_ = false;
            failures_ = 0;
        }
        return !locked_;
    }

    void failure(uint32_t nowMs) {
        if (locked_) return;
        if (++failures_ >= max_) {
            locked_ = true;
            lockedAt_ = nowMs;
        }
    }

    void success() { failures_ = 0; }

private:
    uint8_t max_;
    uint32_t lockout_;
    uint8_t failures_ = 0;
    bool locked_ = false;
    uint32_t lockedAt_ = 0;
};

// The footer font is single-byte ASCII. Replace each UTF-8 sequence with
// '?' and control characters with ' ', truncate to outCap-1 characters.
inline size_t sanitizeAscii(const char *in, size_t n, char *out, size_t outCap) {
    if (out == nullptr || outCap == 0) return 0;
    size_t o = 0;
    size_t i = 0;
    while (in != nullptr && i < n && o + 1 < outCap) {
        const unsigned char c = static_cast<unsigned char>(in[i]);
        if (c < 0x80) {
            out[o++] = (c < 0x20 || c == 0x7F) ? ' ' : static_cast<char>(c);
            i++;
            continue;
        }
        size_t len = 1;
        if (c >= 0xF0) len = 4;
        else if (c >= 0xE0) len = 3;
        else if (c >= 0xC0) len = 2;
        i += len;
        out[o++] = '?';
    }
    out[o] = '\0';
    return o;
}

// Hex string -> bytes. Returns the byte count, or -1 on malformed input.
inline int hexDecode(const char *s, size_t n, uint8_t *out, size_t cap) {
    if (s == nullptr || n % 2 != 0 || n / 2 > cap) return -1;
    auto nib = [](char c) -> int {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    };
    for (size_t i = 0; i < n; i += 2) {
        const int hi = nib(s[i]);
        const int lo = nib(s[i + 1]);
        if (hi < 0 || lo < 0) return -1;
        out[i / 2] = static_cast<uint8_t>((hi << 4) | lo);
    }
    return static_cast<int>(n / 2);
}

}  // namespace prov
