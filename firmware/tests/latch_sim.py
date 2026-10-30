"""Discrete-event model of the NFC task of firmware 1.1.0 (nfc_task.cpp).

Timing constants are taken from the firmware; the PN532 success-read time,
the server round trip and the per-poll miss probability are model
parameters (not measured) and are swept. The NFC task never blocks on the
request or on the result display: the request runs in the Net task and the
2.5 s hold is a UI timer, so polling continues throughout.

  Q1  A card left on the reader: how many duplicate check_card requests per
      hour does the K-miss re-arm rule produce, as a function of miss rate p?
  Q2  Queue hand-off: is the next card accepted when it is presented g empty
      polls after the previous one (conventional latch vs UID-aware latch)?
"""
import csv
import json
import random
import sys
from pathlib import Path

NFC_POLL_TIMEOUT_MS = 250   # config.h: NFC_POLL_TIMEOUT_MS
LOOP_DELAY_MS = 5           # nfc_task.cpp: vTaskDelay(5)
T_SUCCESS_MS = 50           # model parameter: successful InListPassiveTarget
T_HTTP_MS = 150             # model parameter: request round trip on the LAN

MISS_POLL_MS = NFC_POLL_TIMEOUT_MS + LOOP_DELAY_MS
HIT_POLL_MS = T_SUCCESS_MS + LOOP_DELAY_MS


def duplicates_per_hour(p_miss: float, k: int, rng: random.Random,
                        horizon_ms: float = 3_600_000.0) -> tuple[int, int]:
    """Card stays on the reader for the whole horizon (Q1).

    Returns (duplicate requests, duplicate admissions answered "Busy").
    """
    t = 0.0
    latched = False
    misses = 0
    requests = 0
    busy = 0
    net_free_at = 0.0
    while t < horizon_ms:
        if rng.random() < p_miss:          # card present but not read
            t += MISS_POLL_MS
            if latched:
                misses += 1
                if misses >= k:
                    latched = False
                    misses = 0
        else:                              # card read
            t += HIT_POLL_MS
            misses = 0
            if not latched:
                latched = True
                if t < net_free_at:        # Net task still busy
                    busy += 1
                else:
                    requests += 1
                    net_free_at = t + T_HTTP_MS
    return max(0, requests - 1), busy      # the first request is legitimate


def handoff_processed(g: int, k: int, uid_aware: bool) -> bool:
    """Q2: card A read and removed, card B presented after g empty polls."""
    if uid_aware:
        return True
    return g >= k


def main(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    rng = random.Random(20261030)
    p_values = [0.01, 0.05, 0.10, 0.20, 0.30]
    k_values = [1, 2, 3, 4]
    runs = 20

    q1 = []
    for p in p_values:
        for k in k_values:
            vals = [duplicates_per_hour(p, k, rng) for _ in range(runs)]
            req = [v[0] for v in vals]
            busy = [v[1] for v in vals]
            q1.append({"p_miss": p, "k": k,
                       "dup_per_hour": round(sum(req) / runs, 1),
                       "min": min(req), "max": max(req),
                       "busy_per_hour": round(sum(busy) / runs, 1)})

    with open(out_dir / "q1_duplicates.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(q1[0]))
        w.writeheader()
        w.writerows(q1)

    # Pivot for the figure; zero means are written as nan (log axis).
    with open(out_dir / "q1_pivot.csv", "w") as f:
        f.write("p k1 k2 k3 k4\n")
        for p in p_values:
            row = [r["dup_per_hour"] for r in q1 if r["p_miss"] == p]
            f.write(" ".join([str(p)] + [str(v) if v > 0 else "nan" for v in row]) + "\n")

    q2 = [{"g": g, **{f"k{k}": int(handoff_processed(g, k, False)) for k in k_values},
           "uid_aware": int(handoff_processed(g, 3, True))} for g in range(5)]
    with open(out_dir / "q2_handoff.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(q2[0]))
        w.writeheader()
        w.writerows(q2)

    summary = {
        "params": {"MISS_POLL_MS": MISS_POLL_MS, "HIT_POLL_MS": HIT_POLL_MS,
                   "T_SUCCESS_MS": T_SUCCESS_MS, "T_HTTP_MS": T_HTTP_MS,
                   "runs": runs, "seed": 20261030},
        "conventional_rearm_ms": {k: k * MISS_POLL_MS for k in k_values},
        "max_admissions_per_min": round(60_000 / (HIT_POLL_MS + T_HTTP_MS), 1),
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))
    for row in q1:
        print(row)


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "results"))
