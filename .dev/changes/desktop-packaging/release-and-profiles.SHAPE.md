---
status: completed
---

# Desktop release and development profiles

User decisions: a formally published Desktop ZIP must pass GUI verification; Desktop must never block the VS Code extension release; only FrostPi-owned development data is isolated. Pi login, extensions, skills and session history remain unchanged. The user subsequently authorized committing the completed changes after normal manual operation was reported. Tags, pushes and publication remain unauthorized.

Keep the extension and Desktop release workflows independent. The initial prediction was to leave the extension workflow untouched; inspection showed its root `pnpm check` included Desktop-only checks. The user's explicit independence requirement therefore also needs a shared/extension-only check scope in the existing orchestration and its use in the extension release. Extending one shared workflow could keep jobs independent, but would still share orchestration and future gating changes. The Desktop-owned workflow instead handles tag builds, actual extracted-ZIP GUI verification and its own upload to the same GitHub Release. Upload failure never gates extension work. Hosted GUI capability remains unverified locally: failures must stop Desktop publication rather than skip checks.

## Predicted diff

```text
.github/workflows/desktop.yml                 modify  ~60%         tag trigger, GUI gate, candidate artifact, independent publish job
.github/workflows/release.yml                 modify  +1/-2         use shared/extension-only quality gate
scripts/{check,quality,build}.mjs             modify  +8–15         optional VS Code-only scope; default both products unchanged
package.json                                 modify  +3            extension-only check, release preparation, manual-test entry
apps/desktop/scripts/
  prepare-release.mjs                        create  +50–80        bind successful GUI report, ZIP hash, clean source and tag; write checksum
  development-profile.mjs                    create  +10–20        FrostPi-only development environment policy
  start.mjs                                  modify  +3–6          use development environment; packaged exe defaults unchanged
  smoke.mjs                                  modify  +5–15         atomic enabled-button click; preserve scenarios
  native-window.ps1                          modify  +12–16        report shell icon-rectangle result; no product workaround
  manual-smoke.mjs                           create  +75–100       controlled, hash-bound human test setup and same-profile reopen
apps/desktop/test/packaging.test.mjs          modify  +90–130       release gate and isolated manual-test setup/reopen behavior
apps/desktop/test/developmentProfile.test.mjs create  +25–45        default/override profile and unchanged Pi environment
.dev/docs/{development,release,testing,index}.md modify +25–50       commands, independent release gates and data boundary
.dev/changes/desktop-packaging/manual-acceptance.SOP.md create +70–100 task-local GUI checks and result checklist
apps/desktop/SPEC.md                          modify  +3–6          development profile must not redirect Pi data
```

## Experiments and verification

- Controlled send experiment: real packaged executable, five fresh isolated profiles. Original helper produced one failure: before click status changed from stopped toward startup; no click event fired and controlled Pi received no prompt. Combining enabled check and click in one renderer task passed five runs, including stopped-at-check startup cases. No product sending code changed.
- Tray diagnostics captured `Shell_NotifyIconGetRect == 1` for the actual native icon id (2 with the pinned Tauri/tray-icon constructors). The dependency accepts only S_OK (0), so it drops the synthetic notification before invoking the restore/menu behavior. Hidden/overflow icon behavior is the leading explanation; actual human clicks are required to settle it. Do not skip tray assertions or change product tray behavior based only on the automated failure.
- The user authorized a simple manual SOP if automation remains unreliable. `manual-smoke.mjs` prepares a controlled temporary test environment and binds reopening to the same ZIP hash. It creates no GUI pass attestation and does not bypass the existing automatic publication gate.
- Publish-job reruns compare existing asset bytes and upload only missing assets; changed published bytes fail. This resolves partial-upload recovery without clobbering published artifacts.
- Verify profile policy and release evidence using focused tests; run native/JS checks as affected; run the actual packaged GUI with announced isolated windows. Hosted workflow and real publication remain unexecuted until separately authorized Git operations make them available.

## Final comparison

Implementation and diff comparison are complete. The extension-only quality scope was a necessary expansion after finding the original release's Desktop dependency, and was explained before implementation. Manual setup/SOP were added after the user explicitly offered to test when automation failed. The SOP was initially misplaced under `.dev/docs`; it was moved into this change directory and its permanent-documentation entry was removed after user correction. No product tray workaround, alternate credential store, installer or publication bypass was added. The automatic Desktop release gate remains closed pending reliable GUI acceptance; this completed shape is not a release approval. Results and the human-test handoff are in [release-and-profiles.VERIFICATION.md](release-and-profiles.VERIFICATION.md).
