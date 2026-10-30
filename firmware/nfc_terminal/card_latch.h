// card_latch.h - UID-aware card latch (firmware 1.1.0).
//
// Pure C++ with no Arduino dependencies, so the exact same code runs in the
// sketch and in the host-side test harness.
//
// Semantics:
//   * A card is processed when the latch is open, or when the detected UID
//     differs from the last processed UID (immediate hand-off).
//   * The same UID is processed again only after `missThreshold` consecutive
//     polls without any card (the card was physically removed).
//   * Any detection resets the miss counter.
//
// The conventional latch is obtained with `uidAware = false`: while
// latched, every detection - including a different UID - only resets the
// miss counter.

#pragma once

#include <stdint.h>
#include <string.h>

constexpr uint8_t CARD_LATCH_MAX_UID = 10;

struct CardLatch {
    bool latched = false;
    uint8_t misses = 0;
    uint8_t uidLength = 0;
    uint8_t uid[CARD_LATCH_MAX_UID] = {0};
};

enum class LatchAction : uint8_t { None, Process };

inline void cardLatchReset(CardLatch &latch) {
    latch.latched = false;
    latch.misses = 0;
    latch.uidLength = 0;
    memset(latch.uid, 0, sizeof(latch.uid));
}

inline bool cardLatchSameUid(const CardLatch &latch, const uint8_t *uid,
                             uint8_t uidLength) {
    return uidLength == latch.uidLength &&
           memcmp(uid, latch.uid, uidLength) == 0;
}

// One poll result in, one decision out. `uid` may be null when !detected.
inline LatchAction cardLatchStep(CardLatch &latch, bool detected,
                                 const uint8_t *uid, uint8_t uidLength,
                                 uint8_t missThreshold, bool uidAware = true) {
    if (missThreshold == 0) {
        missThreshold = 1;
    }

    if (detected) {
        if (uid == nullptr || uidLength == 0 || uidLength > CARD_LATCH_MAX_UID) {
            return LatchAction::None;  // malformed read: ignore, keep state
        }

        latch.misses = 0;

        const bool newCard = !latch.latched ||
                             (uidAware && !cardLatchSameUid(latch, uid, uidLength));
        if (!newCard) {
            return LatchAction::None;
        }

        latch.latched = true;
        latch.uidLength = uidLength;
        memcpy(latch.uid, uid, uidLength);
        return LatchAction::Process;
    }

    if (latch.latched) {
        latch.misses++;
        if (latch.misses >= missThreshold) {
            latch.latched = false;
            latch.misses = 0;
        }
    }
    return LatchAction::None;
}
