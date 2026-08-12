# CryptoBud V6 secure credential audit

## Pre-change flow (commit 46047eb)

1. `SettingsPage` collected both values in React string state.
2. `ApiCredentialsStore.saveApiCredentials` passed the raw pair to `SettingsPersistence.saveApiConfig`.
3. `SettingsPersistence` serialized the pair as JSON under `api_config` and wrote it to memory, browser `localStorage`, and (when available) the generic Tauri SQLite app-state table.
4. `ApiCredentialsStore.getCredentialsForTest` loaded the plaintext pair back into the renderer.
5. `LiveBinanceAdapter` requested that pair for every signed REST request and private-stream authentication.
6. `BinancePrivateClient` performed HMAC-SHA256 in JavaScript. The raw secret did not cross JS to native for signing; it never left JS because it was already persisted in renderer-accessible storage.
7. The normal settings/backup export exposed only configured state and a masked key, but the generic app-state design and uncentralized log-data handling did not provide a repository-wide credential exclusion invariant.
8. `local_fallback` was explicitly plaintext and `tauri_app_state` was unencrypted SQLite. `Run Live Check` correctly rejected both.

## V6 target and implemented boundary

```text
Settings renderer (transient input)
  -> ApiCredentialsStore (sole lifecycle owner)
  -> Tauri command
  -> OS keyring (one protected API-key + secret payload)

Private operation query parameters
  -> BinancePrivateClient
  -> ApiCredentialsStore signing capability
  -> native Rust HMAC using the OS-keyring secret
  -> renderer receives API key + signature, never the stored secret
```

The OS provider is Windows Credential Manager, macOS Keychain, or Linux Secret Service through `keyring`. There is no plaintext fallback. Browser-only/Paper operation reports the secure store unavailable and remains usable; LIVE fails closed.

Legacy plaintext credentials are detection-only. They are never trusted for LIVE. The user must re-enter and save the pair; only after a verified secure write is the credential-specific legacy record erased. Failure to erase it rolls back the new secure credential.

No credential cache is retained in JavaScript. Native retrieval occurs only for explicit status/lifecycle operations and signed private requests. Scanner, AutoBots, candidate evaluation, public market data, and Paper/Demo paths do not access the secure store.

## Security and lifecycle invariants

- LIVE activation and every LIVE submission require configured, secure, healthy credentials and no legacy plaintext copy.
- Deletion is blocked while LIVE exposure is open.
- Replacement closes the prior private stream before authenticating exactly one replacement stream.
- Deletion disconnects private infrastructure; it does not erase PositionManager state.
- Exporters recursively omit credential/signature fields; logger messages and structured data are centrally redacted.
- Native and renderer errors expose normalized codes, never native error detail or credential values.
- Live Check uses server time, signed account read, signed non-existent order lookup, and a short-lived private-stream authentication. It never submits, cancels, or modifies an order.

## Performance invariant

`privateRequestsPerCandidate = 0`, `secureStoreCallsPerScan = 0`. Secure-store access is not wired into MarketScanner, AutoBots, candidate evaluation, UI render polling, or public data.
