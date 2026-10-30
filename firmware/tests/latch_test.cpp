// Host test of card_latch.h (firmware 1.1.0) against
// the conventional consecutive-miss latch, reproduced below as a reference.
#include <cstdio>
#include <random>
#include <vector>

#include "card_latch.h"

// ---- reference: conventional (UID-agnostic) consecutive-miss latch ----
struct Ref101 { bool cardLatched = false; uint8_t noCardPollCount = 0; };
static bool ref101Step(Ref101 &r, bool cardDetected) {
    bool process = false;
    if (cardDetected) {
        r.noCardPollCount = 0;
        if (!r.cardLatched) { r.cardLatched = true; process = true; }
    } else if (r.cardLatched) {
        r.noCardPollCount++;
        if (r.noCardPollCount >= 3) { r.cardLatched = false; r.noCardPollCount = 0; }
    }
    return process;
}

struct Poll { bool detected; uint8_t card; };  // card id 1..n, 0 = none
static const uint8_t UIDS[4][7] = {{0}, {0x04, 0xA1, 0xB2, 0xC3},
                                   {0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66},
                                   {0x9F, 0x01, 0x02, 0x03}};
static const uint8_t LENS[4] = {0, 4, 7, 4};

static int failures = 0, checks = 0;
#define CHECK(c, ...) do { ++checks; if (!(c)) { ++failures; std::printf("FAIL: " __VA_ARGS__); std::printf("\n"); } } while (0)

static int countProcess(const std::vector<Poll> &trace, bool uidAware, uint8_t k) {
    CardLatch l; int n = 0;
    for (const auto &p : trace)
        if (cardLatchStep(l, p.detected, p.detected ? UIDS[p.card] : nullptr,
                          p.detected ? LENS[p.card] : 0, k, uidAware) == LatchAction::Process) ++n;
    return n;
}

int main() {
    // P1: uidAware=false reproduces the conventional latch exactly on random multi-card traces.
    std::mt19937 rng(20261028);
    long steps = 0;
    for (int t = 0; t < 20000; ++t) {
        Ref101 ref; CardLatch l;
        for (int i = 0; i < 200; ++i, ++steps) {
            const bool det = rng() % 3 != 0; const uint8_t c = 1 + rng() % 3;
            const bool a = ref101Step(ref, det);
            const bool b = cardLatchStep(l, det, det ? UIDS[c] : nullptr, det ? LENS[c] : 0, 3, false) == LatchAction::Process;
            CHECK(a == b, "P1 divergence trace %d step %d", t, i);
        }
    }
    // P2: with a single card, uidAware=true makes exactly the conventional-latch decisions
    // (so duplicate suppression - Table VI - is unchanged).
    for (int t = 0; t < 20000; ++t) {
        Ref101 ref; CardLatch l;
        for (int i = 0; i < 200; ++i, ++steps) {
            const bool det = rng() % 3 != 0;
            const bool a = ref101Step(ref, det);
            const bool b = cardLatchStep(l, det, det ? UIDS[1] : nullptr, det ? LENS[1] : 0, 3, true) == LatchAction::Process;
            CHECK(a == b, "P2 divergence trace %d step %d", t, i);
        }
    }
    // S1: hand-off - card A read, removed, card B presented after g empty polls.
    std::printf("handoff: empty_polls_before_B  conventional_B_processed  uid_aware_B_processed\n");
    for (int g = 0; g <= 4; ++g) {
        std::vector<Poll> tr = {{true, 1}};
        for (int i = 0; i < g; ++i) tr.push_back({false, 0});
        for (int i = 0; i < 5; ++i) tr.push_back({true, 2});   // B held for 5 polls
        const int old = countProcess(tr, false, 3) - 1, neu = countProcess(tr, true, 3) - 1;
        std::printf("  %d  %d  %d\n", g, old, neu);
        CHECK(neu == 1, "S1 v1.1 must process B (g=%d)", g);
        CHECK(old == (g >= 3 ? 1 : 0), "S1 conventional reference mismatch (g=%d)", g);
    }
    // S2: same card re-presented before re-arm is still suppressed.
    {
        std::vector<Poll> tr = {{true, 1}, {false, 0}, {false, 0}, {true, 1}};
        CHECK(countProcess(tr, true, 3) == 1, "S2 same UID re-processed before K misses");
    }
    // S3: alternation A,B,A without gaps -> every change is a new presentation.
    {
        std::vector<Poll> tr = {{true, 1}, {true, 2}, {true, 1}, {true, 3}};
        CHECK(countProcess(tr, true, 3) == 4, "S3 alternation");
        CHECK(countProcess(tr, false, 3) == 1, "S3 conventional alternation");
    }
    // S4: malformed read (length 0 / too long) changes nothing.
    {
        CardLatch l; uint8_t big[12] = {0};
        CHECK(cardLatchStep(l, true, big, 0, 3) == LatchAction::None, "S4 len0");
        CHECK(cardLatchStep(l, true, big, 12, 3) == LatchAction::None, "S4 len12");
        CHECK(!l.latched, "S4 state changed");
    }
    std::printf("random_steps=%ld checks=%d failures=%d\n", steps, checks, failures);
    return failures ? 1 : 0;
}
