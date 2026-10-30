// Host test for nfc_terminal/provisioning.h (firmware 1.1.0).
// Build: g++ -std=c++17 -O2 -Wall -Wextra -fsanitize=address,undefined -I../nfc_terminal provisioning_test.cpp -o provisioning_test
#include <cstdio>
#include <random>
#include <string>

#include "provisioning.h"

using namespace prov;

static int checks = 0, failures = 0;
#define CHECK(c, ...) do { ++checks; if (!(c)) { ++failures; std::printf("FAIL %d: ", __LINE__); std::printf(__VA_ARGS__); std::printf("\n"); } } while (0)

static Field F(const std::string &s) { return Field{s.c_str(), s.size()}; }

struct Case { const char *name; std::string url, key, bar, ca, ssid, pass; bool plain; Err want; };

int main() {
    const std::string pem = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";
    const Case cases[] = {
        {"valid https", "https://api.example.com/x", "k", "b", "", "", "", false, Err::Ok},
        {"valid http dev", "http://10.0.0.5:8091/api", "k", "b", "", "", "", true, Err::Ok},
        {"http blocked", "http://10.0.0.5:8091/api", "k", "b", "", "", "", false, Err::PlainHttpBlocked},
        {"missing url", "", "k", "b", "", "", "", false, Err::MissingField},
        {"missing key", "https://a", "", "b", "", "", "", false, Err::MissingField},
        {"missing barrier", "https://a", "k", "", "", "", "", false, Err::MissingField},
        {"url too long", "https://" + std::string(343, 'a'), "k", "b", "", "", "", false, Err::TooLong},
        {"url max", "https://" + std::string(342, 'a'), "k", "b", "", "", "", false, Err::Ok},
        {"key 64", "https://a", std::string(64, 'k'), "b", "", "", "", false, Err::Ok},
        {"key 65", "https://a", std::string(65, 'k'), "b", "", "", "", false, Err::TooLong},
        {"barrier 65", "https://a", "k", std::string(65, 'b'), "", "", "", false, Err::TooLong},
        {"header injection", "https://a", "k", "abc\r\nX-Evil: 1", "", "", "", false, Err::InvalidChar},
        {"barrier with space ok", "https://a", "k", "Bearer abc", "", "", "", false, Err::Ok},
        {"semicolon now ok", "https://a", "k;x", "b;y", "", "", "", false, Err::Ok},
        {"url space", "https://a b", "k", "b", "", "", "", false, Err::InvalidChar},
        {"bad scheme", "ftp://a", "k", "b", "", "", "", false, Err::BadScheme},
        {"scheme only", "https://", "k", "b", "", "", "", false, Err::BadScheme},
        {"ca ok", "https://a", "k", "b", pem, "", "", false, Err::Ok},
        {"ca not pem", "https://a", "k", "b", "garbage", "", "", false, Err::BadCaCert},
        {"ca too long", "https://a", "k", "b", pem + std::string(3800, 'A'), "", "", false, Err::TooLong},
        {"wifi ok", "https://a", "k", "b", "", "office", "password1", false, Err::Ok},
        {"wifi open", "https://a", "k", "b", "", "office", "", false, Err::Ok},
        {"wifi pass short", "https://a", "k", "b", "", "office", "short", false, Err::BadWifi},
        {"wifi pass no ssid", "https://a", "k", "b", "", "", "password1", false, Err::BadWifi},
        {"ssid 33", "https://a", "k", "b", "", std::string(33, 's'), "", false, Err::BadWifi},
    };
    for (const Case &c : cases) {
        Input in{F(c.url), F(c.key), F(c.bar), F(c.ca), F(c.ssid), F(c.pass)};
        const Err got = validate(in, c.plain);
        CHECK(got == c.want, "validate '%s' got %d want %d", c.name, (int)got, (int)c.want);
    }

    // ctEquals
    CHECK(ctEquals("abc", 3, "abc", 3), "ct equal");
    CHECK(!ctEquals("abc", 3, "abd", 3), "ct diff");
    CHECK(!ctEquals("abc", 3, "abcd", 4), "ct len");
    CHECK(!ctEquals(nullptr, 0, "a", 1), "ct null");

    // OTP generation: uniform-ish over 10 buckets, always 6 digits
    std::mt19937 rng(20261028);
    static std::mt19937 *g = &rng;
    auto rnd = []() -> uint32_t { return (*g)(); };
    int buckets[10] = {0};
    for (int i = 0; i < 200000; i++) {
        const uint32_t c = makeOtpCode(rnd);
        CHECK(c < 1000000, "otp range");
        buckets[c / 100000]++;
        char s[7]; formatOtp(c, s);
        if (i < 1000) CHECK(strlen(s) == 6, "otp format");
    }
    for (int b : buckets) CHECK(b > 19000 && b < 21000, "otp bucket %d", b);
    char z[7]; formatOtp(42, z); CHECK(strcmp(z, "000042") == 0, "leading zeros %s", z);

    // OTP window
    OtpWindow w;
    CHECK(w.check("000000", 6, 0) == OtpWindow::Check::Closed, "closed initially");
    w.open(1000, 123456, 120000, 5);
    CHECK(w.isOpen(1000) && strcmp(w.code(), "123456") == 0, "open");
    CHECK(w.check("123457", 6, 2000) == OtpWindow::Check::Wrong, "wrong");
    CHECK(w.check("12345", 5, 2000) == OtpWindow::Check::Wrong, "short");
    CHECK(w.check("12345a", 6, 2000) == OtpWindow::Check::Wrong, "nondigit");
    CHECK(w.check("123456", 6, 3000) == OtpWindow::Check::Ok, "ok");
    CHECK(w.check("123456", 6, 3000) == OtpWindow::Check::Closed, "single use");
    w.open(0, 111111, 120000, 5);
    CHECK(w.check("111111", 6, 120000) == OtpWindow::Check::Closed, "expired");
    w.open(0, 222222, 120000, 5);
    for (int i = 0; i < 4; i++) CHECK(w.check("000000", 6, 10) == OtpWindow::Check::Wrong, "try %d", i);
    CHECK(w.check("000000", 6, 10) == OtpWindow::Check::Locked, "locked after 5");
    CHECK(w.check("222222", 6, 10) == OtpWindow::Check::Closed, "locked stays closed");
    w.open(0xFFFFFF00u, 333333, 120000, 5);  // millis() wrap-around
    CHECK(w.isOpen(0x00000100u), "wraparound open");
    CHECK(w.check("333333", 6, 0x00000100u) == OtpWindow::Check::Ok, "wraparound ok");

    // Auth throttle
    AuthThrottle t(5, 60000);
    for (int i = 0; i < 4; i++) { CHECK(t.allowed(0), "allowed %d", i); t.failure(0); }
    CHECK(t.allowed(0), "4 failures allowed");
    t.failure(100);
    CHECK(!t.allowed(100), "locked");
    CHECK(!t.allowed(60099), "still locked");
    CHECK(t.allowed(60100), "unlocked");
    t.failure(1); t.success(); for (int i = 0; i < 4; i++) t.failure(2);
    CHECK(t.allowed(2), "success resets");

    // ASCII sanitising for the footer
    char out[77];
    const std::string geo = "\xE1\x83\x92\xE1\x83\x90 ok";  // two Georgian letters
    sanitizeAscii(geo.c_str(), geo.size(), out, sizeof(out));
    CHECK(strcmp(out, "?? ok") == 0, "utf8 -> '%s'", out);
    sanitizeAscii("a\r\nb", 4, out, sizeof(out));
    CHECK(strcmp(out, "a  b") == 0, "ctl -> '%s'", out);
    const std::string longText(200, 'x');
    CHECK(sanitizeAscii(longText.c_str(), longText.size(), out, sizeof(out)) == 76, "truncate 76");
    const std::string cut = "ab\xE1\x83";  // truncated UTF-8 at end
    sanitizeAscii(cut.c_str(), cut.size(), out, sizeof(out));
    CHECK(strcmp(out, "ab?") == 0, "truncated utf8 -> '%s'", out);

    // hexDecode
    uint8_t buf[4];
    CHECK(hexDecode("0aFF", 4, buf, 4) == 2 && buf[0] == 0x0A && buf[1] == 0xFF, "hex ok");
    CHECK(hexDecode("abc", 3, buf, 4) == -1, "hex odd");
    CHECK(hexDecode("zz", 2, buf, 4) == -1, "hex bad");
    CHECK(hexDecode("0011223344", 10, buf, 4) == -1, "hex overflow");

    std::printf("provisioning: checks=%d failures=%d\n", checks, failures);
    return failures ? 1 : 0;
}
