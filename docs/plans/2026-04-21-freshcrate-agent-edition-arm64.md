# freshcrate Agent Edition arm64 Expansion Plan

> For Hermes: use subagent-driven-development to execute this plan slice-by-slice. Do not jump straight to a phone or Switch image before the generic arm64 substrate is real.

Goal: ship a real arm64 Agent Edition lane that works first on generic aarch64 Linux targets, then branches into device-specific overlays for phones, handhelds, and hacked consoles.

Architecture: split the problem into three layers: (1) generic Ubuntu 24.04 arm64 substrate, (2) publishable arm64 artifacts, (3) device overlays for non-generic hardware like Android phones and Nintendo Switch. Do not treat “arm64” and “phone/Switch bootable” as the same milestone.

Tech Stack: Next.js 16, TypeScript, bash, Packer, QEMU, Ubuntu cloud images/installer media, GitHub Actions.

---

## Reality check

Phones and Switch-class hardware are not a generic Ubuntu arm64 target.

What is feasible first:
- Ubuntu 24.04 arm64 headless bootstrap contract
- arm64 QCOW2 / cloud image lane
- arm64 installer metadata and published artifacts

What requires device-specific follow-up:
- Android phone deployment: kernel, boot chain, modem/audio/touch/storage quirks, likely chroot/proot/Termux or postmarketOS-style device work
- Nintendo Switch deployment: custom boot chain, Tegra-specific kernel/device tree, storage/joycon/display/power management

So the first shippable arm64 milestone is:
- generic `ubuntu-24.04-arm64` Agent Edition
- not “boots on any phone/Switch”

---

## Target milestone ladder

### Milestone A — generic arm64 contract
Outcome:
- codebase supports `ubuntu-24.04-arm64` as a first-class target
- bootstrap and verify scripts stop hard-failing on aarch64
- workbench/API/docs expose arm64 intentionally

Acceptance:
- tests cover both x86_64 and arm64 target metadata
- arm64 appears in workbench target options
- no UI copy falsely claims x86_64-only once generic arm64 lane exists

### Milestone B — arm64 image lane
Outcome:
- publishable arm64 QCOW2 or raw cloud-image lane
- packer/qemu template validated for arm64
- artifact metadata, checksums, and release tag exist

Acceptance:
- local build command exists
- GitHub Actions workflow can publish arm64 artifact
- smoke boot validation exists for arm64

### Milestone C — arm64 install lane
Outcome:
- if Ubuntu live-server arm64 remastering is stable, add ISO or installer media lane
- otherwise stay with QCOW2/cloud-init first and do not fake install media readiness

Acceptance:
- unattended install or equivalent first-boot path is verified end-to-end

### Milestone D — device overlays
Outcome:
- separate device families from generic arm64
- create explicit overlays:
  - `android-phone-experimental`
  - `switch-experimental`

Acceptance:
- each overlay has documented boot assumptions, unsupported hardware list, and recovery path
- no claim of support without a tested device matrix

---

## Immediate next slice to implement

### Task 1: make target metadata multi-arch
Objective: let the codebase describe arm64 without yet pretending the full artifact lane is done.

Files:
- Modify: `lib/workbench.ts`
- Modify: `tests/workbench.test.ts`
- Modify: `app/api/page.tsx`
- Modify: `app/agent-edition/page.tsx`
- Modify: `app/page.tsx`
- Modify: `app/layout.tsx`

Steps:
1. Expand `WorkbenchTarget` to include `ubuntu-24.04-arm64`.
2. Decide whether bundles are duplicated per target or changed to support target arrays.
3. Update API/docs copy from “x86_64 only” to “x86_64 stable, arm64 planned/experimental” until artifacts exist.
4. Add tests proving arm64 appears in target metadata only where intended.

Verification:
- `npm test -- --run tests/workbench.test.ts`

### Task 2: un-hardcode architecture checks in bootstrap/verify
Objective: allow generic arm64 substrate validation.

Files:
- Modify: `scripts/bootstrap-agent-edition.sh`
- Modify: `scripts/verify-agent-edition.sh`
- Modify: `scripts/lib/bootstrap-common.sh`
- Create: `tests/agent-edition-arch-contract.test.ts`

Steps:
1. Replace x86_64-only gate with explicit allowlist:
   - `x86_64`
   - `aarch64`
2. Keep Ubuntu 24.04 constraint.
3. Ensure receipts write the detected arch cleanly.
4. Add tests for the allowlist contract.

Verification:
- targeted tests pass
- shell syntax passes with `bash -n`

### Task 3: parameterize image build scripts by target
Objective: stop baking `ubuntu-24.04-x86_64` into every command path.

Files:
- Modify: `scripts/build-agent-edition-image.sh`
- Modify: `scripts/validate-agent-edition-templates.sh`
- Modify: `images/vm-qcow2-headless.pkr.hcl`
- Modify: `images/aws-ami-builder.pkr.hcl`
- Possibly create: `images/vm-qcow2-headless-arm64.pkr.hcl` if cleaner than over-parameterizing

Steps:
1. Add `--target` arg to build script.
2. Support at least:
   - `ubuntu-24.04-x86_64`
   - `ubuntu-24.04-arm64`
3. Map target → source image URL / qemu binary / machine defaults.
4. Validate templates for both targets.

Verification:
- `bash scripts/validate-agent-edition-templates.sh`
- targeted unit tests for command generation

### Task 4: add arm64 artifact lane before arm64 ISO
Objective: ship the easiest real arm64 artifact first.

Files:
- Modify: `lib/workbench-install.ts`
- Modify: `lib/workbench-install-files.ts`
- Modify: `.github/workflows/build-agent-edition-vm-image.yml`
- Modify: tests covering image artifact API

Steps:
1. Add arm64 VM image lane metadata.
2. Publish under distinct release tag, e.g. `agent-edition-vm-qcow2-arm64-latest`.
3. Expose checksum/metadata/download URLs in the API.
4. Keep status experimental until smoke boot passes.

Verification:
- artifact API returns distinct x86_64 vs arm64 lanes
- workflow syntax valid

### Task 5: decide whether arm64 ISO is worth it
Objective: avoid wasting time on a bad lane.

Files:
- Modify: this plan after investigation
- Add findings doc if needed under `docs/`

Decision rule:
- if Ubuntu arm64 live-server remaster + QEMU verification is straightforward, keep ISO lane
- if not, ship QCOW2/cloud-init first and defer ISO

---

## Device overlay strategy

### Android phones
Recommended first approach:
- treat phones as “arm64 operator clients,” not primary bare-metal install targets
- investigate:
  - Termux bootstrap lane
  - chroot/proot containerized lane
  - postmarketOS / Mobian style device support only for specifically tested phones

Do not promise:
- modem
- camera
- GPU
- battery optimization
- touchscreen UX

### Nintendo Switch
Recommended first approach:
- treat as a separate experimental overlay
- require explicit hardware matrix and boot assumptions
- likely based on existing Ubuntu/L4T homebrew paths, not generic Ubuntu arm64 installer media

Do not promise:
- docked graphics
- joycon support
- suspend/resume
- thermal stability

---

## Recommended first shipping scope

Ship in this order:
1. generic arm64 metadata + script allowlist
2. arm64 QCOW2/cloud image lane
3. publish experimental arm64 artifact
4. only then evaluate phone/Switch overlays

This is the fastest honest route to “arm64 version” without lying about unsupported hardware.

---

## Commands to use during execution

- `npm test -- --run tests/workbench.test.ts`
- `bash -n scripts/bootstrap-agent-edition.sh`
- `bash -n scripts/verify-agent-edition.sh`
- `bash -n scripts/build-agent-edition-image.sh`
- `bash scripts/validate-agent-edition-templates.sh`

---

## Definition of done for the first honest arm64 release

Done means:
- `ubuntu-24.04-arm64` exists as a first-class target
- bootstrap + verify accept aarch64
- one arm64 artifact is buildable and publishable
- public UI/API label it experimental, not stable
- phones and Switch remain clearly labeled as future device overlays unless tested on real hardware
