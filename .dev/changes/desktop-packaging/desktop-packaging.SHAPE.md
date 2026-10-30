---
status: completed
---

# Desktop packaging hardening

The user approved implementation without commits or a version change. All public packaging entries rebuild JS and the native executable before staging. Keep the Rust-free JS gate and the VS Code release path unchanged. No installer, signing, updater, publication or automatic CI trigger changes.

## Predicted diff

```text
package.json                                modify   +2/-1        root packaging/native-check orchestration
apps/desktop/
  build.mjs                                 modify   +2/-1        consume shared extension inventory
  scripts/
    packaging.mjs                           modify   +10–20       own extension/payload inventory
    archive-contract.mjs                    create   +70–100      provenance, payload hashes, static ZIP validation
    package-app.mjs                         modify   +20–40       rebuild before staging; embed build info
    verify-package.mjs                      modify   ~70%         durable archive-bound success/failure report
    smoke.mjs                               modify   +3/-1        emit structured failure details for that report
  test/packaging.test.mjs                    create   +90–130      malformed archives, provenance, failed reports
  vitest.config.ts                          modify   +1/-1        discover packaging tests
  src-tauri/tauri.conf.json                  modify   -4–6         remove unused bundle resource inventory
  SPEC.md                                   modify   +2–5         provenance/evidence boundary
eslint.config.js                            modify   +1/-1        Node globals for packaging tests
.github/workflows/desktop.yml                create   +35–50       manual Windows checks and candidate build
.dev/docs/{release,development,feature-map}.md modify  +15–30       supported commands and evidence boundaries
```

## Boundaries

- `packaging.mjs` owns distribution inventory; build, staging and archive validation consume it.
- `package-app.mjs` owns complete rebuild-before-stage ordering, including direct script invocation. No build stamps or mtime freshness tests.
- The ZIP carries commit/dirty/time/version plus payload hashes. Git-unavailable sources are explicitly unknown. This is not signing, exact dirty-source identification or source-to-binary proof.
- The adjacent verification report binds results to archive SHA-256. Requested optional checks are not claimed passed on an unsuccessful smoke run.
- Windows workflow uploads an unverified candidate only. GUI acceptance stays local; no assumption that hosted runners support native automation.

## Verification

Focused packaging tests and Desktop lint/typecheck; native compile/tests; both public packaging entries; extracted executable smoke with isolated Projects/profiles. Announce visible GUI automation before running. Do not alter the historical windows-tauri verification record.

Implementation and diff comparison are complete. The only added decision-bearing file beyond the prediction is `smoke.mjs`: failed GUI runs previously emitted no machine-readable summary, so the report could not preserve their partial results and failure reason. This changes reporting only, not scenarios, assertions or product behavior. Full GUI acceptance remains unsuccessful; see [VERIFICATION.md](VERIFICATION.md). No commits were created at that initial checkpoint.
