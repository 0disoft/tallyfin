# Reading Operational Log Reports in the Administrator UI

In the administrator API connection mode, select the JSON produced by `logs:summary` under
**Settings → Operational Log Report**. The browser Worker reads and validates the file; the file is
not sent to a server or saved in browser storage. You can read a report you already have even
without project permission.

## Creating a Report

After obtaining application logs, run the following from the repository root. Summarize the logs
first rather than placing the source logs in the UI.

```powershell
Get-Content -LiteralPath app-log.ndjson -Encoding utf8 |
  node tools/runtime/summarize-observations.ts --stdin |
  Set-Content -LiteralPath observation-summary.json -Encoding utf8
```

Use only JSON from a CLI run that exited successfully. When using the `npm.cmd` alias, add
`--silent` so the npm banner does not mix with the JSON. The
[log summary guide](../../tools/runtime/LOG-SUMMARY.md) explains the log format, collection scope,
and failure codes.

For captured Wrangler tail JSON, use `--stdin --wrangler-tail`. This extracts only the console
application records from multi-line objects and produces an existing v2 report. The report's input
line count is the number of console records. Source URLs, headers, and exceptions are not placed in
the UI, and additional sampling or omissions may occur. Use a finite log file; a stream that remains
open fails after 30 seconds.

## Values in the UI

- The observed response count is the number of unique log lines. The weighted request estimate
  multiplies the successful sample by 64 and is distinct from an exact total request count.
- Errors and items requiring review use the existing CLI diagnostic rules. A 4xx can be a protective
  response, so it is shown separately from errors. When there are no diagnostic items, the UI says
  only that none were found.
- HTTP responses are grouped by operation, status code, and fixed error code. Long lists are
  paginated, and latency buckets are a coarse observed distribution.
- Cleanup runs and processed-operation counts are separate. A successful processed-operation count
  is not a deleted-row count, and the processed count for a failure without details is unknown. A
  failure marker and a detailed failure can both appear for the same run.
- The UI also shows input lines, ignored logs, and duplicate lines. If an older v2 report has no
  additive diagnostics, it remains marked as having no diagnostics.

The report covers the supplied logs from the entire collector. It is not split by the project or
lookback-period selectors above it, and it does not calculate a time window, exact error rate,
percentiles, or overall service health.

## Reading and Clearing

The file limit is 8 MiB. The reader checks the fields, sample weights, aggregate totals, and
diagnostics of supported `tallyfin.observation-summary/v2` reports. It rejects raw NDJSON, extra
identifiers, format errors, and inconsistencies with a fixed error message. File names and source
content are not included in errors. The Worker is terminated if reading takes longer than 10
seconds.

Selecting a new file clears the previous result and starts a new read. **Clear report**, closing the
panel, leaving the settings screen, or replacing or disconnecting the connection cancels the read
and clears its result. Results that arrive late are ignored. Selecting a file does not add API
requests, automatic polling, or alert delivery.

Production log collection, scheduling, and alert-recipient integration are separate concerns. The
current verification results are recorded in [VALIDATION.md](../../VALIDATION.md).
