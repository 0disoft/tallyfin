# Repeated Authentication Access Monitoring

`monitor:access` runs the 3 GET checks from the existing `install:access-check` once per invocation,
compares them with the previous state for the same installation target, and emits JSON describing
consecutive failures, recovery, and whether a notification is needed. The operator chooses the
cadence, failure count, and alert recipients. The tool does not register a scheduled run.

```powershell
npm run --silent monitor:access -- --dir <prepared-installation> --state <local-state.json> --failure-threshold <1..100> --recovery-threshold <1..100> --max-gap-seconds <1..86400> --token-stdin
```

## Inputs and Scope

The command validates the installation bundle, policy, and existing state, acquires a state lock,
and then reads one new access-token line from the operator's existing safe token source over
non-interactive standard input. It never records the token in arguments, files, or reports. Input has
a 30-second limit, checks have a 15-second limit, individual requests have a 5-second limit, and
response bodies are capped at 16 KiB, matching the [access check](INSTALL-ACCESS-CHECK.md). This
command does not issue or refresh tokens.

The checks run in the order identity → administrator storage read → one project. If an earlier check
fails, later reads are skipped. Requests target the reviewed administrator HTTPS origin and use no
redirects, cookies, retries, or remote writes. A 401 or 403, storage error, malformed response, or
network timeout is an observation that this access could not be verified. Do not extend it to a
full-service outage or collection and cleanup status. Failed token input, invalid state, and tool
cancellation are not stored as valid observations. SIGINT and SIGTERM cancel input and checks and
clean up the lock. A forced termination does not guarantee that handling.

## State and Notification Intent

| event | Meaning | notify |
| --- | --- | --- |
| healthy | Access verified and no open issue | false |
| failure_pending | Consecutive failures have not reached the threshold | false |
| incident_opened | Consecutive failures reached the threshold | true |
| incident_ongoing | Access could not be verified again while an incident is open | false |
| recovery_pending | Access was verified, but consecutive recoveries are insufficient | false |
| incident_resolved | Consecutive successes reached the recovery threshold | true |

A failure clears the success streak, and a success clears the failure streak. If the gap between 2
successes or failures exceeds `max-gap-seconds`, the streak is reset and counting resumes from the
current observation. An open incident remains open. Set the maximum interval with headroom over the
scheduled interval, and monitor a missing run separately through the scheduler.

State stores only the schema, the SHA-256 of the target's public configuration, policy, UTC check
times, consecutive counts, and whether an incident is open. It does not store tokens, accounts,
subjects, project rows, or URLs. It rejects files with a different policy or target, and rejects a
clock that moved backward or is equal to the previous observation. When policy changes, review the
existing incident and then explicitly choose a separate state file.

The command writes only to the specified location and creates the parent directory if needed. It
creates `<state>.lock` exclusively to prevent overlapping runs from using the same path. It syncs a
temporary file and replaces the state with a rename. Corrupt, oversized, or symlinked state files are
not reset automatically. If a lock remains after a forced process termination, the operator must
confirm that no run using that state is still active before clearing it. Each run uses one state
file; the scheduler must not split the same target across separate files.

## Output and Operational Integration

The output is `tallyfin.access-monitor/v1` and contains only fixed check codes, the current
`accessVerified` and `incidentOpen` values, the event and notify values above, consecutive counts,
and whether the allowed gap was exceeded. The following values are fixed: `scope=administrator_access`,
`serviceHealth=unknown`, `remoteChanges=false`, and `notificationsSent=false`. Exit code 0 means
current access is verified and no incident is open; 1 means verification failed or recovery is
pending; 2 means an argument, installation, state, token-input, or tool failure. Stderr prints only a
fixed code.

The operational scheduler supplies the token, runs the schedule, stores output, and delivers alerts.
It can use `notify=true` as a delivery condition, but the command does not send alerts. State
replacement and stdout delivery are not one transaction, so losing output does not guarantee alert
delivery. Operational integration should also monitor task failure and missing output, and check the
current `incidentOpen` value.

Focused checks and failure and recovery results with the real administrator proxy, signed OIDC, and
local D1 are in the [validation record](../../VALIDATION.md). A real provider, remote execution,
schedule, and recipients are not connected.
