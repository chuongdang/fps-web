# Unreliable transport (WebRTC DataChannel) for snapshots and inputs

Why: the game runs over a WebSocket = TCP. One lost packet freezes the whole connection for 200+ ms and everything sent meanwhile arrives in a burst. Snapshots (20/s) and inputs (60/s) are worth nothing once a newer one exists, so they do not need TCP's guarantees.

## How it works
- The WebSocket stays: join, hits, kills, shop, everything that must arrive. It is also the **fallback**.
- After `Welcome` the client offers an SDP over the WebSocket (`RtcOffer` / `RtcAnswer` / `RtcCandidate`), a DataChannel `game` (`ordered: false, maxRetransmits: 0`) opens, and `shared/unreliable.ts` (`withUnreliable`, same `Transport` interface, used by both ends) routes `Snapshot / Inputs / Ping / Pong` over it while it is **healthy**.
- Healthy = something arrived on it within 1 s. Both ends send a 250 ms keepalive (`ka: true` Ping / Pong, never seen by game code), so a dead path (UDP blocked, NAT rebinding) is noticed within a second, the WebSocket takes over, and the channel is used again when it recovers.
- **Inputs are sent with redundancy** (the last 4 cmds in every packet). The server keeps its queue sorted by seq without duplicates, and over the channel waits `INPUT_GAP_WAIT_TICKS` (6 = 0.1 s) for a cmd that is missing before later ones (late packet) before giving the step up. (Without the wait a late packet's cmd arrives "old" and is thrown away: measured 42% of samples off by > 5 cm at 15 ms jitter, now 0%.)
- A Pong goes back the way its Ping came. While snapshots go over the channel the server sends the weapon state / loadout in **every** snapshot (a lost snapshot must not leave the client stale); on the WebSocket they are sent only when changed (round 1).
- Server: `server/src/rtcTransport.ts` (`werift`, pure JS WebRTC, so it bundles into the single-file server; no native module). Client: `client/src/net/rtc.ts` (browser RTCPeerConnection, STUN `stun.l.google.com`).
- An offer is only accepted from a connection that has joined a room, one peer per connection, at most `FPS_RTC_MAX` (200) peers, SDP <= 16 KB, 15 s to open or the peer is freed.

## Turn it on (off by default: LAN play and the packaged exe need nothing)
Server environment: `FPS_RTC=1`, `FPS_RTC_PUBLIC_IP=<the machine's public IP>` (required behind NAT / Docker), `FPS_RTC_PORTS=20000-20049` (UDP, one per connected player; **open them in every firewall in front of the machine, a cloud firewall too**), `FPS_RTC_MAX`.
Deploy to banhmi: `RTC=1 npm run deploy` (`deploy/docker-compose.rtc.yml` becomes the compose override, publishes the UDP range, passes the settings; without `RTC=1` the override is removed again). Watch memory: the container is limited to 300 MB on a 1 GB box shared with other sites; per-peer memory of werift has not been measured.
Dev: `FPS_RTC=1 npm run dev`; the browser on the same machine needs no public IP.

## Look at it
F3 shows `net path  WebRTC (unreliable) | WebSocket`, packets sent / received per path and how many times it fell back. `?rtc=0` in the URL forces the WebSocket (to compare).
Simulate a bad internet path in the browser (dev): `?lat=40&jit=15&loss=5` (unordered UDP-like channel: delay, jitter that reorders, packets that vanish), and `?stall=300&stallEvery=3000` for what a lossy TCP path does to the WebSocket.

## Tests
`shared/src/unreliable.test.ts` (router), `shared/src/transport.test.ts` (loss / unordered / stall), `server/src/rtcTransport.test.ts` (real UDP on localhost: negotiation, data both ways, cleanup, refusals, env config), `server/src/simulation.test.ts` ("cmds arriving out of order": sorted queue, waiting for a late cmd, giving up, a 400-tick stream with random delay 0-6 ticks and 5% loss ends exactly where an in-order stream does; fails with the wait at 0).
