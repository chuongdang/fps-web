# Phase 5 – Luật Team Deathmatch "Cớm vs Cướp"

Mục tiêu: một trận đấu hoàn chỉnh có đầu có cuối.

## Config (`shared/src/teams.ts`, `shared/src/constants.ts`)

```ts
export const TEAMS = {
  A: { name: 'Cớm',  color: 0x2f6fd6, uiColor: '#2f6fd6' },
  B: { name: 'Cướp', color: 0x2b2b2b, uiColor: '#e0a030' },
} as const;
export type TeamId = 'A' | 'B';

export const MATCH = {
  maxPerTeam: 5,
  minPlayersToStart: 2,
  countdownMs: 5000,
  durationMs: 10 * 60 * 1000,
  killLimit: 50,
  endScreenMs: 10000,
  friendlyFire: false,
};
```

## Message thêm

```ts
  | { t: 111; phase: MatchPhase; phaseEndsAt: number; scoreA: number; scoreB: number; sideSwapped: boolean } // MatchState (gửi khi đổi, và mỗi 1s)
  | { t: 112; id: number; team: TeamId }                                    // TeamAssigned
  | { t: 113; rows: { id: number; name: string; team: TeamId; kills: number; deaths: number; ping: number }[] } // Scoreboard (mỗi 1s)

// C2S
  | { t: 4; team: TeamId | 'auto' }                                          // ChooseTeam
```

`NetPlayer` thêm `team`.

---

## Task 5.1 – Đội + chia đội

Làm:
- Vào phòng: client chọn Cớm / Cướp / Tự động. Server từ chối nếu đội đó đông hơn đội kia ≥ 1 người (trả về đội được gán thay thế).
- Nhân vật người khác tô màu đội. Đồng đội có tên hiện trên đầu (màu đội); kẻ địch **không** hiện tên.
- Server phase 4: bỏ qua hitbox của đồng đội (đạn **xuyên qua** đồng đội, không chặn).
- Spawn và hồi sinh theo căn cứ của đội (có tính đổi bên, task 5.4).

Nghiệm thu:
- [ ] 3 người: không thể cho 3 người vào cùng một đội khi đội kia có 0.
- [ ] Bắn đồng đội: không hitmarker, không mất máu; đạn đi xuyên trúng kẻ địch phía sau.
- [ ] Hồi sinh luôn ở căn cứ đội mình.

---

## Task 5.2 – State machine trận đấu

```
WAITING ──(đủ minPlayersToStart)──► COUNTDOWN ──(5s)──► PLAYING
   ▲                                    │                   │
   │                       (không đủ người)      (hết giờ / đủ killLimit)
   └────────────────────────────────────┘                   ▼
                                    COUNTDOWN ◄──(10s)── ENDED
```

- WAITING: chơi tự do, không tính điểm, hồi sinh ngay.
- COUNTDOWN: mọi người đứng yên ở spawn (server bỏ qua input di chuyển), HUD đếm ngược to giữa màn hình.
- PLAYING: tính điểm. Mỗi kill cộng 1 cho đội người bắn. Bản đầu **không có sát thương do rơi**.
- ENDED: hiện "CỚM THẮNG" / "CƯỚP THẮNG" / "HOÀ", bảng điểm tự mở, không bắn được.
- Hết ENDED → reset điểm, kill/death, máu, đạn, **đổi bên**, vào COUNTDOWN.

Nghiệm thu:
- [ ] Đặt tạm `durationMs = 60000`, `killLimit = 5` để test: cả 2 điều kiện kết thúc đều hoạt động.
- [ ] Trong COUNTDOWN không đi được, nhưng vẫn xoay chuột được.
- [ ] Còn 1 người trong phòng giữa trận: quay về WAITING.

---

## Task 5.3 – Bảng điểm + HUD điểm đội

Làm:
- HUD trên giữa: `Cớm 12 — 9 Cướp` + đồng hồ đếm ngược trận (tính từ `phaseEndsAt` và `serverNow()`).
- Giữ Tab: bảng 2 cột theo đội, sắp xếp theo kill giảm dần, cột: tên, K, D, ping. Dòng của mình tô nổi.
- Ping lấy từ server (server đo RTT bằng ping riêng của nó hoặc client tự báo RTT trong Ping message).

Nghiệm thu:
- [ ] Bảng điểm cập nhật trong 1 giây sau mỗi kill.
- [ ] Đồng hồ trận ở 3 tab lệch nhau < 1 giây.

---

## Task 5.4 – Đổi bên + người vào giữa trận

Làm:
- `sideSwapped = true`: đội A spawn ở căn cứ B và ngược lại. Mỗi trận mới đảo cờ này.
- Người vào giữa trận PLAYING: auto vào đội ít người hơn (vẫn cho chọn nếu cân bằng), spawn ngay có bất tử.
- Người rời giữa trận: điểm đội giữ nguyên.

Nghiệm thu (bài kiểm tra cuối phase = định nghĩa "xong" bản đầu tiên):
- [ ] 4–6 người chơi hết 2 trận liên tiếp: trận 2 đã đổi bên, điểm reset, không lỗi.
- [ ] Người vào giữa trận được chia đội đúng, chơi bình thường.
