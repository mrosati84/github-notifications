# Pagination — Functional Specification

Audience: an agent that must reproduce this pagination control **exactly**.
This document describes behaviour and semantics only. It is language-agnostic
and framework-agnostic; it is written entirely in terms of the symbols below and
has no dependency on any particular technology.

**Showcase parameters used in every example:** page size `P = 10`, window
(middle) size `W = 5`, and a total item count `N` that may be indefinite.
General rules are stated in terms of `P`, `W`, `T` and `p`; all concrete
examples use `10` and `5`.

Notation: `...` is the omitted-pages indicator. A frame is written as a
space-separated sequence, e.g. `1 ... 8 9 10 11 12 ... 20`.

---

## 1. Purpose & scope

The control lets a user move through a potentially very large set of items that
has been divided into fixed-size pages. It presents a compact, bounded,
deterministic navigation frame containing:

- a previous-page chevron,
- an ordered sequence of page-number tokens interleaved with up to two
  omitted-pages indicators (`...`),
- a next-page chevron.

The frame is bounded in size regardless of how many items exist, so it remains
stable and cheap to compute even when the item count is indefinite or enormous.

**In scope:** which tokens appear, in what order, which page is current, which
chevrons are enabled, how navigation changes state, and the exact algorithm that
maps state to a frame.

**Out of scope:** visual design, styling, sizing, spacing, colours, typography,
animation, layout, and the concrete technology used to present the tokens.
Those decisions do not affect the token sequence specified here.

---

## 2. Definitions & symbols

### 2.1 Symbols

| Symbol | Meaning |
|---|---|
| `N` | Total number of items: an integer `>= 0`. May be large or indefinite. |
| `P` | Page size: the maximum number of items on a page. Integer `>= 1`; showcase `P = 10`. |
| `W` | Window size: the requested maximum number of middle page numbers. Integer; showcase `W = 5`. |
| `W_eff` | Effective window size, `W_eff = maximum(3, round_down(W))`. Always `>= 3`. |
| `T` | Total number of pages. Derived (section 4); always `>= 1`. |
| `p` | Current page: the 1-based page currently active. Always within `1..T`. |
| `k` | A page index, `1 <= k <= T`. |
| `s`, `e` | First and last page numbers of the selected middle window (`1 < s <= e < T`). |
| `...` | The omitted-pages indicator. |
| `[a, b]` | A contiguous run of pages from `a` to `b` inclusive. |

### 2.2 Terms

| Term | Definition |
|---|---|
| **Item** | One entry being paginated. Items are addressed by their 1-based position. |
| **Page** | A contiguous block of at most `P` consecutive items. Pages are numbered from `1`. |
| **Total items** | `N`: the number of items, an integer `>= 0`. May be large or indefinite. |
| **Page size** | `P`: the maximum number of items on a page. Showcase `P = 10`. |
| **Total pages** | `T`: the number of pages. Derived (section 4). Always `>= 1`. |
| **Current page** | `p`: the 1-based page currently active. Always within `1..T`. |
| **Window / middle frame** | A contiguous run `[s, e]` of page numbers strictly between page `1` and page `T` that the algorithm selects for display. |
| **Omitted-pages indicator** | The token `...`. It stands for a **non-empty** run of two or more consecutive omitted pages. Non-interactive. |
| **Chevron** | The previous-page and next-page navigation tokens. A chevron is either enabled or disabled. |
| **Page tokens** | The ordered sequence of page-number tokens and `...` indicators within a frame, **excluding** the two chevrons. |
| **Frame** | The complete control: the previous chevron, then the page tokens, then the next chevron. |
| **Active page** | The single page token, equal to `p`, carrying the active state. |

---

## 3. Inputs & parameters

| Parameter | Symbol | Type / domain | Showcase | Notes |
|---|---|---|---:|---|
| Total items | `N` | integer `>= 0`, unbounded | indefinite | Number of items. `0` is valid. Must be handled without iterating over it. |
| Page size | `P` | integer `>= 1` | `10` | Maximum items per page. |
| Window size | `W` | integer | `5` | Requested maximum number of middle page numbers. Effective value is `W_eff = maximum(3, round_down(W))` (section 3.1). |
| Current page | `p` | integer, 1-based | e.g. `1` | Clamped into `1..T`. |

### 3.1 Effective window size

The effective window size is `W_eff = maximum(3, round_down(W))`. A missing or
non-numeric requested `W` defaults to `5`. Any requested value below `3`,
including `0` or negative values, behaves exactly as `3`. The minimum exists
because a window smaller than three cannot simultaneously respect the cap and
avoid a single-page omission gap (section 14).

---

## 4. Derived values

Let `P` be the page size and `N` the total number of items.

1. **Total pages**

   ```
   T = maximum(1, ceiling(N / P))
   ```

   `N = 0` yields `T = 1`. With `P = 10`, `N = 10` yields `T = 1`, and
   `N = 11` yields `T = 2`.

2. **Item range of a page** (page `k`, `1 <= k <= T`)

   ```
   first item of page k = (k - 1) * P + 1
   last  item of page k = minimum(k * P, N)
   ```

   The last page may be partially filled. An empty item set produces page `1`
   with an empty range.

3. **Visibility rule** — the control is shown **iff**

   ```
   N > 0  AND  T >= 2
   ```

   With `P = 10` the control is hidden for `0` through `10` items and first
   appears at `11` items, i.e. `2` pages. When hidden, no frame is produced and
   no navigation is possible.

4. **Computational cost is independent of `N`.** The frame algorithm uses only
   `T` and `p`; it never enumerates items or pages. `N` may therefore be
   indefinite or extremely large, and the frame remains bounded
   (at most `W_eff + 4` page tokens, or `W_eff + 6` frame elements once the two
   chevrons are included; section 8).

---

## 5. Frame composition & ordering

Two terms are used precisely throughout this document:

- **Page tokens** — the ordered sequence of page-number tokens and `...`
  indicators, **excluding** the two chevrons.
- **Frame** — the complete control: the previous chevron, then the page tokens,
  then the next chevron.

When the control is shown (`N > 0` and `T >= 2`), a frame consists of,
in this exact order:

1. the **previous chevron** (always present, enabled or disabled),
2. the **page tokens**, in order:
   - page number `1`,
   - optionally `...`,
   - the selected middle window page numbers `s, s+1, ..., e`, strictly
     ascending,
   - optionally `...`,
   - page number `T`,
3. the **next chevron** (always present, enabled or disabled).

Exactly one page token is marked **active**: the page-number token equal to
`p`. Because `p` is always present in the page tokens (section 8), the active
token always exists and is unique.

---

## 6. Chevron rules

| Rule | Statement |
|---|---|
| Previous enabled | `p > 1`. |
| Previous disabled | `p = 1`. |
| Next enabled | `p < T`. |
| Next disabled | `p = T`. |
| Activation effect | An enabled chevron navigates by exactly one page: previous sets `p = p - 1`, next sets `p = p + 1`. |
| Disabled behaviour | A disabled chevron is non-activatable and **must never** navigate. |
| Boundary no-op | Activating previous at `p = 1`, or next at `p = T`, is a no-op: `p` is unchanged and no change notification is emitted (section 12). |
| Presence | Both chevrons are always part of the frame, even when disabled. |

---

## 7. Ellipsis rules (when and why)

### 7.1 What `...` means and why it exists

`...` is a single token that stands for a **non-empty run of consecutive
omitted pages**, and by rule it always stands for **at least two** pages. It
exists because the frame is deliberately bounded: an item set of unbounded size
must still produce a bounded, stable frame. `...` compresses a long gap between
displayed page numbers into one token.

`...` is **non-interactive**: activating it does nothing and changes no state.

### 7.2 Exactly when an ellipsis appears

Let the selected middle window be `[s, e]` (all middle pages satisfy
`1 < s <= e < T`).

| Indicator | Appears iff | Equivalent wording |
|---|---|---|
| Left `...` (between `1` and `s`) | `s >= 4` | at least 2 pages are omitted between page `1` and `s` (namely pages `2 .. s-1`) |
| Right `...` (between `e` and `T`) | `e <= T - 3` | at least 2 pages are omitted between `e` and `T` (namely pages `e+1 .. T-1`) |
| No left `...` | `s = 2` | `s` is adjacent to page `1`; nothing omitted |
| No right `...` | `e = T - 1` | `e` is adjacent to page `T`; nothing omitted |
| Both absent | `s = 2` and `e = T - 1` | every page is shown |

The only two possibilities for each side are therefore **0 omitted pages** (no
indicator) or **>= 2 omitted pages** (one indicator). One omitted page is
impossible by construction.

### 7.3 The single-page-gap correction (why `...` never hides exactly one page)

If an indicator would stand for exactly one page, that page is **absorbed into
the window** instead. A frame such as `1 ... 3 4 5` (which would hide only page
`2`) or `1 2 3 ... 5` (which would hide only page `4`) is malformed and must
never be produced.

Before → after:

| Malformed (would hide exactly one page) | Corrected frame | What happened |
|---|---|---|
| `1 ... 3 4 5` | `1 2 3 4 5` | page `2` absorbed into the window |
| `1 2 3 ... 5` | `1 2 3 4 5` | page `4` absorbed into the window |
| `1 ... 4 5 6 7 8 9` | `1 ... 4 5 6 7 8 9` | valid: hides pages `2,3` (two pages) |
| `1 2 3 4 5 6 ... 9` | `1 2 3 4 5 6 ... 9` | valid: hides pages `7,8` (two pages) |

The window-selection algorithm (section 9) enforces this by rejecting any
candidate window whose left or right omitted count equals exactly `1`. Because
the window can be shortened or shifted, a valid window always exists for
`W_eff >= 3`.

### 7.4 Additional structural rules

- `...` is **never** the first or the last token of a frame.
- `...` is **never** immediately followed or preceded by another `...`; two
  indicators never appear in a row.
- A frame contains **at most two** `...` tokens.
- Every `...` sits directly between two page numbers; it is never adjacent to a
  chevron.
- `...` is non-interactive and can never be the active token.

---

## 8. Page-number rules

1. Page `1` is always present.
2. Page `T` is always present.
3. The current page `p` is always present.
4. The number of page numbers strictly between `1` and `T` (the middle page
   numbers) is **at most `W_eff`**.
5. All page numbers in a frame are **unique**, **strictly ascending**, and
   within `1..T`.
6. If `T <= W_eff + 2` (with `W = 5`, `T <= 7`), **all** pages are shown and
   there is **no** `...`.
7. The total number of numeric tokens is at most `W_eff + 2` (with `W = 5`,
   at most `7`).
8. The **page-token** count (page numbers plus `...` indicators, **excluding**
   the two chevrons) is at most `W_eff + 4` (with `W = 5`, at most `9`). The
   **frame element** count, including the two chevrons, is therefore at most
   `W_eff + 6` (with `W = 5`, at most `11`).

The first omission therefore happens at `T = W_eff + 3` (with `W = 5`,
`T = 8`).

---

## 9. Window selection algorithm (normative)

This is the normative definition of the token sequence. Reproduce it
exactly, including the tie-break.

### 9.1 Pseudocode

The following is language-neutral pseudocode; it is not written in any
particular programming language and may be implemented in any language.

Notation used below: `round_down(x)` is the greatest integer not greater than
`x`; `ceiling(x)` is the least integer not less than `x`; `minimum(a, b)` and
`maximum(a, b)` are the smaller and larger of `a` and `b`; `absolute(x)` is the
non-negative magnitude of `x`; `clamp(x, lo, hi) = minimum(maximum(x, lo), hi)`;
`NONE` denotes "no value"; `INFINITY` denotes a value larger than any candidate
distance. Statements assign with `<-` (an arrow pointing from the value to the
target); `=` always denotes equality, never assignment.

```
BUILD-FRAME(T, p, W):
    T <- round_down(T)
    if T is not finite, or T < 1:
        return an empty page-token sequence   # no control is shown

    p <- round_down(p)
    if p is not finite:
        p <- 1
    p <- clamp(p, 1, T)                  # current page inside range

    W <- round_down(W)
    if W is not finite:
        W <- 5
    W_eff <- maximum(3, W)               # effective window size

    if T <= 2:
        return [1] if T = 1 else [1, 2]

    c <- clamp(p, 2, T - 1)              # centring anchor
    prefer_smaller_start <- (2 * p <= T + 1)   # first half, incl. exact centre

    window_start <- NONE
    window_end <- NONE
    for m from minimum(W_eff, T - 2) down to 1:   # try longest window first
        best_start <- NONE
        best_distance <- INFINITY
        for s from maximum(2, c - m + 1) to minimum(c, T - m):
            e <- s + m - 1
            left_omitted  <- s - 2       # pages 2 .. s-1
            right_omitted <- T - e - 1   # pages e+1 .. T-1

            valid <- (left_omitted = 0 or left_omitted >= 2)
                     and
                     (right_omitted = 0 or right_omitted >= 2)
            if not valid:
                continue

            distance <- absolute((s + e) / 2 - p)   # window-centre distance
            if distance < best_distance
               or (distance = best_distance
                   and (best_start is NONE
                        or (prefer_smaller_start and s < best_start)
                        or (not prefer_smaller_start and s > best_start))):
                best_distance <- distance
                best_start <- s

        if best_start is not NONE:
            window_start <- best_start
            window_end <- best_start + m - 1
            break

    if window_start is NONE:             # unreachable for W_eff >= 3
        window_start <- 2
        window_end <- T - 1

    page_tokens <- [1]
    if window_start > 2:  add "..." to page_tokens
    for page from window_start to window_end:  add page to page_tokens
    if window_end < T - 1:  add "..." to page_tokens
    add T to page_tokens
    return page_tokens
```

### 9.2 Rule-by-rule rationale

| Rule | Why |
|---|---|
| `T < 1` returns no frame | There is no page to show. |
| `p` clamped to `1..T` | The active page can never be out of range. |
| `W_eff = maximum(3, W)` | A window below 3 cannot both honour the cap and avoid a single-page gap (section 14). |
| `T <= 2` special case | With one page the frame is `1`; with two pages all pages fit, so no middle window is needed. |
| Anchor `c = clamp(p, 2, T-1)` | A middle window can only be placed strictly inside `1..T`; `c` is the desired centre, clamped so a window around it can exist. |
| Search `m` from longest to shortest | Prefer the largest allowed window; this keeps the most pages visible and lets the cap be met exactly when possible. |
| `s` range `maximum(2, c-m+1) .. minimum(c, T-m)` | All placements of an `m`-long window that contain the anchor `c` and fit strictly inside `1..T`. |
| Validity test (`left_omitted = 0 or >= 2`, same for right) | Directly enforces the never-hide-exactly-one-page rule (section 7). |
| Score `absolute((s+e)/2 - p)` minimised | Choose the window whose centre is closest to the current page, so the current page sits as centrally as possible. |
| Tie-break `prefer_smaller_start` | When two windows are equally centred, break toward the nearer boundary: smaller `s` in the first half (`2p <= T+1`), larger `s` in the second half. This makes the two ends mirror-consistent (section 10). |
| First `m` with a valid `s` wins | The descending `m` loop fixes the window length; within it the best `s` is chosen by score then tie-break. |
| Fallback `(2, T-1)` | Defensive only; with `W_eff >= 3` a valid window always exists, so it is unreachable. |
| Token assembly | Emit `1`, a left `...` iff `window_start > 2` (equivalent to `s >= 4` for valid windows), the window, a right `...` iff `window_end < T-1` (equivalent to `e <= T-3`), then `T`. |

---

## 10. Invariants (must always hold)

For any accepted input with the control shown:

1. The frame is non-empty.
2. Page `1` is present.
3. Page `T` is present.
4. The current page `p` is present.
5. Exactly one token is active, and it equals `p`.
6. Page numbers are unique.
7. Page numbers are strictly ascending.
8. Every page number lies within `1..T` and is an integer.
9. The count of middle page numbers (strictly between `1` and `T`) is at most
   `W_eff`.
10. Every `...` stands for at least 2 omitted pages; no indicator ever stands
    for exactly 1 omitted page.
11. `...` is never the first or last token.
12. `...` is never adjacent to another `...`.
13. `...` is always directly between two page numbers.
14. At most two `...` tokens appear per frame.
15. The page-number count is at most `W_eff + 2`.
16. The page-token count (page numbers plus `...` indicators, excluding the two
    chevrons) is at most `W_eff + 4`; consequently the frame element count,
    including the two chevrons, is at most `W_eff + 6`.
17. When `T <= W_eff + 2`, every page `1..T` appears and there is no `...`.
18. When `T >= W_eff + 3`, at least one page is omitted and at least one `...`
    appears.
19. The frame depends only on `(T, p, W_eff)` and is deterministic: equal inputs
    always yield equal frames.
20. The frame is bounded independently of `N`.
21. The previous chevron is enabled exactly when `p > 1`; the next chevron is
    enabled exactly when `p < T`.
22. A disabled chevron cannot navigate, and activating a chevron at its boundary
    changes no state.
23. If `T = 1` the frame is `[1]`; if `T = 2` the frame is `[1, 2]`.
24. Mirror consistency: for every `(T, p)` except the single self-mirror pair
    `(T, p) = (9, 5)`, the frame for `(T, p)` equals the mirror-complement of the
    frame for `(T, T+1-p)`, where the mirror-complement reflects each page
    number by `x -> T+1-x`, keeps `...`, and reverses the order. `(9, 5)` is
    inherently impossible to make self-symmetric because the two best windows
    are exactly equidistant; the tie-break must choose one side. (This property
    is stated for `W = 5`; for other `W` the only unavoidable exceptions are the
    self-mirror centres where a genuine tie occurs.)

---

## 11. Worked examples & conformance tables

The tables below are normative expected outputs; they follow directly from the
algorithm in section 9 and define conformance. Frames use `...` for the
omitted-pages indicator.

### Table A — total pages `T` = 1..12, every current page `p` (P = 10)

| Total pages | Total items at P = 10 | Current page | Frame |
|---:|---|---:|---|
| 1 | 0-10 | 1 | `1` |
| 2 | 11-20 | 1 | `1 2` |
| 2 | 11-20 | 2 | `1 2` |
| 3 | 21-30 | 1 | `1 2 3` |
| 3 | 21-30 | 2 | `1 2 3` |
| 3 | 21-30 | 3 | `1 2 3` |
| 4 | 31-40 | 1 | `1 2 3 4` |
| 4 | 31-40 | 2 | `1 2 3 4` |
| 4 | 31-40 | 3 | `1 2 3 4` |
| 4 | 31-40 | 4 | `1 2 3 4` |
| 5 | 41-50 | 1 | `1 2 3 4 5` |
| 5 | 41-50 | 2 | `1 2 3 4 5` |
| 5 | 41-50 | 3 | `1 2 3 4 5` |
| 5 | 41-50 | 4 | `1 2 3 4 5` |
| 5 | 41-50 | 5 | `1 2 3 4 5` |
| 6 | 51-60 | 1 | `1 2 3 4 5 6` |
| 6 | 51-60 | 2 | `1 2 3 4 5 6` |
| 6 | 51-60 | 3 | `1 2 3 4 5 6` |
| 6 | 51-60 | 4 | `1 2 3 4 5 6` |
| 6 | 51-60 | 5 | `1 2 3 4 5 6` |
| 6 | 51-60 | 6 | `1 2 3 4 5 6` |
| 7 | 61-70 | 1 | `1 2 3 4 5 6 7` |
| 7 | 61-70 | 2 | `1 2 3 4 5 6 7` |
| 7 | 61-70 | 3 | `1 2 3 4 5 6 7` |
| 7 | 61-70 | 4 | `1 2 3 4 5 6 7` |
| 7 | 61-70 | 5 | `1 2 3 4 5 6 7` |
| 7 | 61-70 | 6 | `1 2 3 4 5 6 7` |
| 7 | 61-70 | 7 | `1 2 3 4 5 6 7` |
| 8 | 71-80 | 1 | `1 2 3 4 5 ... 8` |
| 8 | 71-80 | 2 | `1 2 3 4 5 ... 8` |
| 8 | 71-80 | 3 | `1 2 3 4 5 ... 8` |
| 8 | 71-80 | 4 | `1 2 3 4 5 ... 8` |
| 8 | 71-80 | 5 | `1 ... 4 5 6 7 8` |
| 8 | 71-80 | 6 | `1 ... 4 5 6 7 8` |
| 8 | 71-80 | 7 | `1 ... 4 5 6 7 8` |
| 8 | 71-80 | 8 | `1 ... 4 5 6 7 8` |
| 9 | 81-90 | 1 | `1 2 3 4 5 6 ... 9` |
| 9 | 81-90 | 2 | `1 2 3 4 5 6 ... 9` |
| 9 | 81-90 | 3 | `1 2 3 4 5 6 ... 9` |
| 9 | 81-90 | 4 | `1 2 3 4 5 6 ... 9` |
| 9 | 81-90 | 5 | `1 2 3 4 5 6 ... 9` |
| 9 | 81-90 | 6 | `1 ... 4 5 6 7 8 9` |
| 9 | 81-90 | 7 | `1 ... 4 5 6 7 8 9` |
| 9 | 81-90 | 8 | `1 ... 4 5 6 7 8 9` |
| 9 | 81-90 | 9 | `1 ... 4 5 6 7 8 9` |
| 10 | 91-100 | 1 | `1 2 3 4 5 6 ... 10` |
| 10 | 91-100 | 2 | `1 2 3 4 5 6 ... 10` |
| 10 | 91-100 | 3 | `1 2 3 4 5 6 ... 10` |
| 10 | 91-100 | 4 | `1 2 3 4 5 6 ... 10` |
| 10 | 91-100 | 5 | `1 2 3 4 5 6 ... 10` |
| 10 | 91-100 | 6 | `1 ... 5 6 7 8 9 10` |
| 10 | 91-100 | 7 | `1 ... 5 6 7 8 9 10` |
| 10 | 91-100 | 8 | `1 ... 5 6 7 8 9 10` |
| 10 | 91-100 | 9 | `1 ... 5 6 7 8 9 10` |
| 10 | 91-100 | 10 | `1 ... 5 6 7 8 9 10` |
| 11 | 101-110 | 1 | `1 2 3 4 5 6 ... 11` |
| 11 | 101-110 | 2 | `1 2 3 4 5 6 ... 11` |
| 11 | 101-110 | 3 | `1 2 3 4 5 6 ... 11` |
| 11 | 101-110 | 4 | `1 2 3 4 5 6 ... 11` |
| 11 | 101-110 | 5 | `1 2 3 4 5 6 ... 11` |
| 11 | 101-110 | 6 | `1 ... 4 5 6 7 8 ... 11` |
| 11 | 101-110 | 7 | `1 ... 6 7 8 9 10 11` |
| 11 | 101-110 | 8 | `1 ... 6 7 8 9 10 11` |
| 11 | 101-110 | 9 | `1 ... 6 7 8 9 10 11` |
| 11 | 101-110 | 10 | `1 ... 6 7 8 9 10 11` |
| 11 | 101-110 | 11 | `1 ... 6 7 8 9 10 11` |
| 12 | 111-120 | 1 | `1 2 3 4 5 6 ... 12` |
| 12 | 111-120 | 2 | `1 2 3 4 5 6 ... 12` |
| 12 | 111-120 | 3 | `1 2 3 4 5 6 ... 12` |
| 12 | 111-120 | 4 | `1 2 3 4 5 6 ... 12` |
| 12 | 111-120 | 5 | `1 2 3 4 5 6 ... 12` |
| 12 | 111-120 | 6 | `1 ... 4 5 6 7 8 ... 12` |
| 12 | 111-120 | 7 | `1 ... 5 6 7 8 9 ... 12` |
| 12 | 111-120 | 8 | `1 ... 7 8 9 10 11 12` |
| 12 | 111-120 | 9 | `1 ... 7 8 9 10 11 12` |
| 12 | 111-120 | 10 | `1 ... 7 8 9 10 11 12` |
| 12 | 111-120 | 11 | `1 ... 7 8 9 10 11 12` |
| 12 | 111-120 | 12 | `1 ... 7 8 9 10 11 12` |

### Table B — total pages `T` = 20, every current page `p` (P = 10)

| Current page | Frame |
|---:|---|
| 1 | `1 2 3 4 5 6 ... 20` |
| 2 | `1 2 3 4 5 6 ... 20` |
| 3 | `1 2 3 4 5 6 ... 20` |
| 4 | `1 2 3 4 5 6 ... 20` |
| 5 | `1 2 3 4 5 6 ... 20` |
| 6 | `1 ... 4 5 6 7 8 ... 20` |
| 7 | `1 ... 5 6 7 8 9 ... 20` |
| 8 | `1 ... 6 7 8 9 10 ... 20` |
| 9 | `1 ... 7 8 9 10 11 ... 20` |
| 10 | `1 ... 8 9 10 11 12 ... 20` |
| 11 | `1 ... 9 10 11 12 13 ... 20` |
| 12 | `1 ... 10 11 12 13 14 ... 20` |
| 13 | `1 ... 11 12 13 14 15 ... 20` |
| 14 | `1 ... 12 13 14 15 16 ... 20` |
| 15 | `1 ... 13 14 15 16 17 ... 20` |
| 16 | `1 ... 15 16 17 18 19 20` |
| 17 | `1 ... 15 16 17 18 19 20` |
| 18 | `1 ... 15 16 17 18 19 20` |
| 19 | `1 ... 15 16 17 18 19 20` |
| 20 | `1 ... 15 16 17 18 19 20` |

### Table C — large totals: representative frames

Boundary and interior samples for `T = 100`, `1000`, `12345`. For interior pages
`6 <= p <= T - 5`, the frame is the sliding window
`1 ... (p-2) (p-1) p (p+1) (p+2) ... T`. This follows directly from the
algorithm in section 9: for those pages the centre-anchored window is valid, so
it is the longest valid window and scores best.

| Total pages | Current page | Frame | Region |
|---:|---:|---|---|
| 100 | 1 | `1 2 3 4 5 6 ... 100` | first |
| 100 | 2 | `1 2 3 4 5 6 ... 100` | first |
| 100 | 3 | `1 2 3 4 5 6 ... 100` | first |
| 100 | 4 | `1 2 3 4 5 6 ... 100` | first |
| 100 | 5 | `1 2 3 4 5 6 ... 100` | first |
| 100 | 6 | `1 ... 4 5 6 7 8 ... 100` | first |
| 100 | 49 | `1 ... 47 48 49 50 51 ... 100` | middle |
| 100 | 50 | `1 ... 48 49 50 51 52 ... 100` | middle |
| 100 | 51 | `1 ... 49 50 51 52 53 ... 100` | middle |
| 100 | 95 | `1 ... 93 94 95 96 97 ... 100` | last |
| 100 | 96 | `1 ... 95 96 97 98 99 100` | last |
| 100 | 97 | `1 ... 95 96 97 98 99 100` | last |
| 100 | 98 | `1 ... 95 96 97 98 99 100` | last |
| 100 | 99 | `1 ... 95 96 97 98 99 100` | last |
| 100 | 100 | `1 ... 95 96 97 98 99 100` | last |
| 1000 | 1 | `1 2 3 4 5 6 ... 1000` | first |
| 1000 | 2 | `1 2 3 4 5 6 ... 1000` | first |
| 1000 | 3 | `1 2 3 4 5 6 ... 1000` | first |
| 1000 | 4 | `1 2 3 4 5 6 ... 1000` | first |
| 1000 | 5 | `1 2 3 4 5 6 ... 1000` | first |
| 1000 | 6 | `1 ... 4 5 6 7 8 ... 1000` | first |
| 1000 | 499 | `1 ... 497 498 499 500 501 ... 1000` | middle |
| 1000 | 500 | `1 ... 498 499 500 501 502 ... 1000` | middle |
| 1000 | 501 | `1 ... 499 500 501 502 503 ... 1000` | middle |
| 1000 | 995 | `1 ... 993 994 995 996 997 ... 1000` | last |
| 1000 | 996 | `1 ... 995 996 997 998 999 1000` | last |
| 1000 | 997 | `1 ... 995 996 997 998 999 1000` | last |
| 1000 | 998 | `1 ... 995 996 997 998 999 1000` | last |
| 1000 | 999 | `1 ... 995 996 997 998 999 1000` | last |
| 1000 | 1000 | `1 ... 995 996 997 998 999 1000` | last |
| 12345 | 1 | `1 2 3 4 5 6 ... 12345` | first |
| 12345 | 2 | `1 2 3 4 5 6 ... 12345` | first |
| 12345 | 3 | `1 2 3 4 5 6 ... 12345` | first |
| 12345 | 4 | `1 2 3 4 5 6 ... 12345` | first |
| 12345 | 5 | `1 2 3 4 5 6 ... 12345` | first |
| 12345 | 6 | `1 ... 4 5 6 7 8 ... 12345` | first |
| 12345 | 6171 | `1 ... 6169 6170 6171 6172 6173 ... 12345` | middle |
| 12345 | 6172 | `1 ... 6170 6171 6172 6173 6174 ... 12345` | middle |
| 12345 | 6173 | `1 ... 6171 6172 6173 6174 6175 ... 12345` | middle |
| 12345 | 12340 | `1 ... 12338 12339 12340 12341 12342 ... 12345` | last |
| 12345 | 12341 | `1 ... 12340 12341 12342 12343 12344 12345` | last |
| 12345 | 12342 | `1 ... 12340 12341 12342 12343 12344 12345` | last |
| 12345 | 12343 | `1 ... 12340 12341 12342 12343 12344 12345` | last |
| 12345 | 12344 | `1 ... 12340 12341 12342 12343 12344 12345` | last |
| 12345 | 12345 | `1 ... 12340 12341 12342 12343 12344 12345` | last |

### Table C-2 — complete distinct frames and ranges for total pages `T` = 100

Each row is a maximal run of consecutive current pages producing the same frame.

| Pages | Frame |
|---|---|
| 1-5 | `1 2 3 4 5 6 ... 100` |
| 6 | `1 ... 4 5 6 7 8 ... 100` |
| 7 | `1 ... 5 6 7 8 9 ... 100` |
| 8 | `1 ... 6 7 8 9 10 ... 100` |
| 9 | `1 ... 7 8 9 10 11 ... 100` |
| 10 | `1 ... 8 9 10 11 12 ... 100` |
| 11 | `1 ... 9 10 11 12 13 ... 100` |
| 12 | `1 ... 10 11 12 13 14 ... 100` |
| 13 | `1 ... 11 12 13 14 15 ... 100` |
| 14 | `1 ... 12 13 14 15 16 ... 100` |
| 15 | `1 ... 13 14 15 16 17 ... 100` |
| 16 | `1 ... 14 15 16 17 18 ... 100` |
| 17 | `1 ... 15 16 17 18 19 ... 100` |
| 18 | `1 ... 16 17 18 19 20 ... 100` |
| 19 | `1 ... 17 18 19 20 21 ... 100` |
| 20 | `1 ... 18 19 20 21 22 ... 100` |
| 21 | `1 ... 19 20 21 22 23 ... 100` |
| 22 | `1 ... 20 21 22 23 24 ... 100` |
| 23 | `1 ... 21 22 23 24 25 ... 100` |
| 24 | `1 ... 22 23 24 25 26 ... 100` |
| 25 | `1 ... 23 24 25 26 27 ... 100` |
| 26 | `1 ... 24 25 26 27 28 ... 100` |
| 27 | `1 ... 25 26 27 28 29 ... 100` |
| 28 | `1 ... 26 27 28 29 30 ... 100` |
| 29 | `1 ... 27 28 29 30 31 ... 100` |
| 30 | `1 ... 28 29 30 31 32 ... 100` |
| 31 | `1 ... 29 30 31 32 33 ... 100` |
| 32 | `1 ... 30 31 32 33 34 ... 100` |
| 33 | `1 ... 31 32 33 34 35 ... 100` |
| 34 | `1 ... 32 33 34 35 36 ... 100` |
| 35 | `1 ... 33 34 35 36 37 ... 100` |
| 36 | `1 ... 34 35 36 37 38 ... 100` |
| 37 | `1 ... 35 36 37 38 39 ... 100` |
| 38 | `1 ... 36 37 38 39 40 ... 100` |
| 39 | `1 ... 37 38 39 40 41 ... 100` |
| 40 | `1 ... 38 39 40 41 42 ... 100` |
| 41 | `1 ... 39 40 41 42 43 ... 100` |
| 42 | `1 ... 40 41 42 43 44 ... 100` |
| 43 | `1 ... 41 42 43 44 45 ... 100` |
| 44 | `1 ... 42 43 44 45 46 ... 100` |
| 45 | `1 ... 43 44 45 46 47 ... 100` |
| 46 | `1 ... 44 45 46 47 48 ... 100` |
| 47 | `1 ... 45 46 47 48 49 ... 100` |
| 48 | `1 ... 46 47 48 49 50 ... 100` |
| 49 | `1 ... 47 48 49 50 51 ... 100` |
| 50 | `1 ... 48 49 50 51 52 ... 100` |
| 51 | `1 ... 49 50 51 52 53 ... 100` |
| 52 | `1 ... 50 51 52 53 54 ... 100` |
| 53 | `1 ... 51 52 53 54 55 ... 100` |
| 54 | `1 ... 52 53 54 55 56 ... 100` |
| 55 | `1 ... 53 54 55 56 57 ... 100` |
| 56 | `1 ... 54 55 56 57 58 ... 100` |
| 57 | `1 ... 55 56 57 58 59 ... 100` |
| 58 | `1 ... 56 57 58 59 60 ... 100` |
| 59 | `1 ... 57 58 59 60 61 ... 100` |
| 60 | `1 ... 58 59 60 61 62 ... 100` |
| 61 | `1 ... 59 60 61 62 63 ... 100` |
| 62 | `1 ... 60 61 62 63 64 ... 100` |
| 63 | `1 ... 61 62 63 64 65 ... 100` |
| 64 | `1 ... 62 63 64 65 66 ... 100` |
| 65 | `1 ... 63 64 65 66 67 ... 100` |
| 66 | `1 ... 64 65 66 67 68 ... 100` |
| 67 | `1 ... 65 66 67 68 69 ... 100` |
| 68 | `1 ... 66 67 68 69 70 ... 100` |
| 69 | `1 ... 67 68 69 70 71 ... 100` |
| 70 | `1 ... 68 69 70 71 72 ... 100` |
| 71 | `1 ... 69 70 71 72 73 ... 100` |
| 72 | `1 ... 70 71 72 73 74 ... 100` |
| 73 | `1 ... 71 72 73 74 75 ... 100` |
| 74 | `1 ... 72 73 74 75 76 ... 100` |
| 75 | `1 ... 73 74 75 76 77 ... 100` |
| 76 | `1 ... 74 75 76 77 78 ... 100` |
| 77 | `1 ... 75 76 77 78 79 ... 100` |
| 78 | `1 ... 76 77 78 79 80 ... 100` |
| 79 | `1 ... 77 78 79 80 81 ... 100` |
| 80 | `1 ... 78 79 80 81 82 ... 100` |
| 81 | `1 ... 79 80 81 82 83 ... 100` |
| 82 | `1 ... 80 81 82 83 84 ... 100` |
| 83 | `1 ... 81 82 83 84 85 ... 100` |
| 84 | `1 ... 82 83 84 85 86 ... 100` |
| 85 | `1 ... 83 84 85 86 87 ... 100` |
| 86 | `1 ... 84 85 86 87 88 ... 100` |
| 87 | `1 ... 85 86 87 88 89 ... 100` |
| 88 | `1 ... 86 87 88 89 90 ... 100` |
| 89 | `1 ... 87 88 89 90 91 ... 100` |
| 90 | `1 ... 88 89 90 91 92 ... 100` |
| 91 | `1 ... 89 90 91 92 93 ... 100` |
| 92 | `1 ... 90 91 92 93 94 ... 100` |
| 93 | `1 ... 91 92 93 94 95 ... 100` |
| 94 | `1 ... 92 93 94 95 96 ... 100` |
| 95 | `1 ... 93 94 95 96 97 ... 100` |
| 96-100 | `1 ... 95 96 97 98 99 100` |

### Table D — explicit edge cases

| Total items | Total pages | Control shown? | Current page | Frame |
|---:|---:|:--:|---:|---|
| 0 | 1 | no | - | _(control hidden)_ |
| 5 | 1 | no | - | _(control hidden)_ |
| 10 | 1 | no | - | _(control hidden)_ |
| 11 | 2 | yes | 1 | `1 2` |
| 20 | 2 | yes | 1 | `1 2` |
| 70 | 7 | yes | 1 | `1 2 3 4 5 6 7` |
| 71 | 8 | yes | 1 | `1 2 3 4 5 ... 8` |
| 200 | 20 | yes | 1 | `1 2 3 4 5 6 ... 20` |
| 200 | 20 | yes | 20 | `1 ... 15 16 17 18 19 20` |
| 200 | 20 | yes | 2 | `1 2 3 4 5 6 ... 20` |
| 200 | 20 | yes | 19 | `1 ... 15 16 17 18 19 20` |
| 200 | 20 | yes | 10 | `1 ... 8 9 10 11 12 ... 20` |

---

## 12. State model & operations

State consists of the total item count `N`, the page size `P`, the window size
`W`, and the current page `p`. Derived state is the total pages `T` (section 4)
and the frame (section 9). All operations are semantically idempotent where
noted.

### 12.1 Operations

| Operation | Semantics |
|---|---|
| **Initialize** (`N`, `P`, `W`, optional `p`) | Establish initial state. Clamp the inputs per section 3. If the current page is omitted it defaults to `1`; otherwise clamp it into `1..T`. **No change notification is emitted on initialization.** |
| **Set total items** (`n`) | Set `N = maximum(0, round_down(n))`, recompute `T`. Clamp `p` into `1..T`. Do **not** reset to page `1`. Emit a change notification only if `p` actually changed. |
| **Set page size** (`n`) | Set `P = maximum(1, round_down(n))`, recompute `T`. Clamp `p` into `1..T`. Do **not** reset to page `1`. Emit a change notification only if `p` actually changed. |
| **Set window size** (`n`) | Set the effective window size to `maximum(3, round_down(n))` and recompute the frame. Does not change `p`, so no navigation change notification is emitted. |
| **Go to page** (`k`) | Clamp the requested page into `1..T`. If the clamped value equals `p`, do nothing. Otherwise set `p` and emit exactly one change notification. |
| **Next page** | If `p < T`, increase `p` by `1` and emit one change notification. Otherwise it is a no-op. |
| **Previous page** | If `p > 1`, decrease `p` by `1` and emit one change notification. Otherwise it is a no-op. |
| **Release** (optional; if the platform has a lifetime/release concept) | Release state. After release, every operation is a no-op and emits no notification. |

### 12.2 Clamping and recomputation

- The current page `p` is always clamped into `1..T`.
- Changing `N` or `P` **only clamps** the current page; it never resets it to
  `1`. For example, if `p = 5` and a change reduces `T` to `3`, the current page
  becomes `3`; if a later change grows `T` again, the page stays at `3`.
- Visibility is recomputed after any change to `N` or `P`: the control is shown
  iff `N > 0` and `T >= 2`.
- The effective window size is recomputed after any change to `W` and is always
  at least `3`.

### 12.3 Change notification

- A change notification means: the current page value changed.
- Emit **only** when `p` actually changes.
- Never emit on initialization.
- Never emit for a no-op navigation (boundary chevron activation, going to the
  current page, setting the window size, or any operation that leaves `p`
  unchanged).

---

## 13. Acceptance-test checklist

Conformance can be verified by checking, for the effective `W_eff` and for a
broad sweep of `(T, p)`:

- [ ] Frame contains page `1`, page `T`, and the current page `p` (when shown).
- [ ] Exactly one active token, equal to `p`.
- [ ] Page numbers are unique, strictly ascending, and within `1..T`.
- [ ] Middle page count `<= W_eff`.
- [ ] Page-number count `<= W_eff + 2`; page-token count `<= W_eff + 4`; frame
      element count including the two chevrons `<= W_eff + 6`.
- [ ] Every `...` hides `>= 2` pages; none hides exactly `1`.
- [ ] `...` is never first, never last, never doubled, never adjacent to a
      chevron, and at most two appear.
- [ ] `T <= W_eff + 2` implies every page is shown and no `...` appears.
- [ ] `T >= W_eff + 3` implies at least one page is omitted and at least one
      `...` appears.
- [ ] Control hidden iff `N = 0` or `T = 1`.
- [ ] With `P = 10`, hidden for `0..10` items and shown from `11` items.
- [ ] Previous enabled iff `p > 1`; next enabled iff `p < T`.
- [ ] Disabled chevrons never navigate; boundary activation is a no-op.
- [ ] Next page / Previous page change the page by exactly `1` when enabled.
- [ ] Go to page clamps into `1..T` and notifies only on an actual change.
- [ ] Changing `N`/`P` clamps but never resets `p`.
- [ ] A requested window size below `3` behaves exactly as `3`.
- [ ] Initialization emits no notification.
- [ ] Frames match Tables A, B, C, C-2 and D exactly.
- [ ] Mirror consistency holds for every `(T, p)` except `(9, 5)` (for `W = 5`).

---

## 14. Parameterisation notes & non-goals

### 14.1 Changing the page size `P`

`P` only affects derived values, never the frame algorithm:

- `T = maximum(1, ceiling(N / P))`.
- The item range of page `k` is `(k-1)*P + 1 .. minimum(k*P, N)`.
- The control is hidden for `0..P` items and first appears at `P + 1` items
  (i.e. when `T` first reaches `2`).

### 14.2 Changing the window size `W`

- Any integer is accepted; the effective value is `maximum(3, W)`.
- Larger `W` allows more middle page numbers and delays the first omission
  (`T = W_eff + 3`).
- `W` never affects the chevrons, the visibility rule, or the page-number and
  ellipsis invariants.

### 14.3 Why `W` has a minimum of 3

A middle frame smaller than `3` cannot simultaneously:

- keep the number of middle page numbers at most `W`, and
- avoid an `...` that hides exactly one page.

Example: `T = 5`, `p = 3`. The only frame that shows page `1`, the current page
`3`, and page `T = 5` without a single-page gap is `1 2 3 4 5`, whose middle
count is `3`. Clamping the effective window size up to `3` keeps the cap
guarantee true for every accepted input.

### 14.4 Non-goals

- Visual design, styling, layout, sizing, colour, typography, animation.
- Page-size selection, jump-to-page entry, or page-range selectors.
- Data retrieval, caching, routing, persistence, or URL synchronisation.
- Exact wording or presentation of any user-facing labels beyond the page
  numbers and the `...` token.
- Accessibility specifics of the surrounding presentation (the semantic rules
  above — enabled/disabled, active page, bounded frame — are still required).

---

## 15. Appendix: GitHub transport & safety bounds (implementation mapping)

This appendix records how this plugin (`Model.js`) realises the pagination model
above against the GitHub REST API. It is descriptive; it does not change the
normative rules in sections 1–14.

### 15.1 Endpoint and query

Every fetch is a read of the authenticated notifications endpoint:

```
GET https://api.github.com/notifications
```

- `per_page` — the page size. The plugin fixes `per_page=5`, i.e. `P = 5`.
- `page` — the 1-based page index, `p` in the notation above.

Both calls are issued by the `gh` CLI with the user's own credentials; the
plugin stores no token.

### 15.2 The one-item count probe

The page request alone cannot reveal the exact total `N` (a full page looks the
same whether or not a next page exists), so each fetch begins with a one-item
probe:

```
GET https://api.github.com/notifications?per_page=1&page=1
```

run as `gh api "notifications?per_page=1&page=1" --include`, so the response
status line and headers are printed as well as the body.

- If the inbox holds more than one unread notification, the headers carry
  `Link: <...?per_page=1&page=N>; rel="last"`; the probe takes `N` from that
  `rel="last"` URL.
- If there is no `Link` header, the inbox holds 0 or 1 notifications; `N` is
  then the length of the probe body array (0 or 1).

`N` is the **total unread count**, not the size of the page on screen.

### 15.3 Derived total pages

Exactly as section 4:

```
T = maximum(1, ceiling(N / 5))
```

### 15.4 The combined command

One `Process` runs one shell command that puts the probe, a sentinel and the
requested page on a single stdout stream:

```sh
set -o pipefail; { gh api "notifications?per_page=1&page=1" --include && \
  printf "\n@@GH_NOTIF_COUNT@@\n" && \
  gh api "notifications?per_page=5&page=P"; } \
  2> >(head -c 8192 >&2) | head -c 262145
```

- `P` is the requested 1-based page (`p`); it is assigned to the command
  immediately before the process starts, so the page number cannot race the run.
- `@@GH_NOTIF_COUNT@@` on its own line separates the probe output from the page
  output; the loader splits stdout at exactly that sentinel.
- stderr is capped at **8192 bytes** and stdout at **262145 bytes**
  (`MAX_STDOUT_BYTES + 1`), so an oversized response is truncated and then
  rejected rather than buffered whole. `set -o pipefail` makes a failure of
  either `gh api` call visible.
- There is no `--paginate` and no `--slurp`.

### 15.5 Retained-field bounds

The parsed view keeps at most one page of items and caps every retained string,
so a pathological response cannot bloat state:

| Field | Cap |
|---|---|
| items per page | 5 (`PAGE_SIZE`) |
| `repository.name` | 200 chars |
| `subject.title` | 300 chars |
| `repository.html_url`, `subject.url` | 512 chars each |

### 15.6 `Link` header on the true last page

For a page request, `rel="last"` is **absent** when the requested page is the
true last page `T`, and **present** (pointing at the last page) whenever the
requested page still has pages after it (`p < T`). The plugin does not rely on
this for the page request — it derives `T` solely from the one-item probe in
15.2 and clamps `p` into `1..T`. The rule is recorded because it is the reason
that probe can recover the exact total without walking the pagination.
