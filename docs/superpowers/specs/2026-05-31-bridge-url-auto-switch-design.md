# Bridge URL Auto Switch Design

## Goal

Agent Chat should automatically choose a reachable Bridge URL when the Mac can be reached by more than one network path, such as same-Wi-Fi LAN and Tailscale Serve.

## Scope

- Keep the existing `remoteBridge.url` setting as the current/preferred URL for backward compatibility.
- Add `remoteBridge.urls` as an ordered candidate list.
- Mobile Bridge execution should try candidates in order and use the first one that succeeds.
- Bridge health detection should also try candidates on mobile; desktop health detection should continue checking local `127.0.0.1:<port>` to avoid MagicDNS self-test false negatives.
- When a candidate succeeds, save it back to `remoteBridge.url` so the next request starts with the known-good path.

## Non-Goals

- Do not expose Bridge token in notes, release notes, or logs.
- Do not make desktop provider execution go through Bridge by default.
- Do not require public internet exposure; this remains LAN or trusted virtual LAN only.

## Data Model

```json
{
  "remoteBridge": {
    "enabled": true,
    "url": "http://192.168.28.42:3876",
    "urls": [
      "http://192.168.28.42:3876",
      "http://x-5.tailc1b10e.ts.net:3876"
    ],
    "token": "<local only>",
    "timeoutMs": 600000
  }
}
```

## Error Handling

If all candidates fail, the plugin should report the first/primary failure and include enough context to show that all configured candidates were attempted, without printing the token.

## Testing

- Unit test candidate URL normalization and de-duplication.
- Unit test remote turn fallback from a failing LAN URL to a working Tailscale URL.
- Unit test that selected URLs are returned to the caller.
- Keep desktop local execution behavior unchanged.
