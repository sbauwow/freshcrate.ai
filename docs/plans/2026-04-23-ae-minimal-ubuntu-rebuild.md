# Agent Edition Minimal Ubuntu Rebuild Plan

> For Hermes: use subagent-driven-development to execute this plan task-by-task.

Goal: rebuild freshcrate Agent Edition on a much smaller Ubuntu-compatible base that keeps Ubuntu 24.04 package compatibility while dropping the heavyweight live-server installer stack.

Architecture: stop remastering the stock Ubuntu 24.04 live-server ISO as the primary long-term base. Instead, build a minimal Ubuntu Noble rootfs directly from Ubuntu repositories, then generate two products from that same rootfs contract: a minimal persistent live USB lane and a minimal installed disk/image lane. Keep the package universe Ubuntu 24.04, but make the base feel Bodhi-like by aggressively trimming installer/snap/desktop baggage.

Tech Stack: Ubuntu 24.04 package repos, mmdebstrap or debootstrap, squashfs, xorriso, casper/cloud-init only where justified, existing freshcrate bootstrap/verify scripts, QEMU validation.

---

## Strategic answer first

Do not literally switch the base to Bodhi if your hard requirement is “Ubuntu 24.04 packages.”

Best path:
- Use Ubuntu 24.04 packages directly
- Build a tiny Noble rootfs yourself
- Add only the AE substrate you actually need

Translation:
- “Bodhi-like” should mean footprint and philosophy
- not “inherit Bodhi’s distro identity and package assumptions”

Why:
- you keep full Ubuntu/Noble package compatibility
- you avoid fighting Bodhi-specific defaults and release cadence
- you can make the live USB and installed image much smaller than current Ubuntu live-server remasters

Target outcome:
- headless base closer to “Ubuntu minimal + AE”
- no subiquity in live USB lane
- no snapd in base unless explicitly justified
- no installer-only package ballast in the persistent live USB lane

---

## Product split to preserve sanity

Keep three separate lanes:

1. `iso-autoinstall-headless`
- purpose: unattended installer media
- can remain heavier if needed in short term
- long term can also move to custom Ubuntu-minimal installer path

2. `iso-live-persistent-x86_64`
- purpose: portable live USB with persistence
- should be the smallest lane
- must not carry installer baggage

3. `vm-qcow2-headless`
- purpose: preinstalled disk image
- should share the same minimal rootfs contract as the live USB lane

Rule:
- persistent live USB and qcow2 should share one minimal Ubuntu rootfs source of truth
- installer ISO is allowed to diverge if necessary

---

## Success criteria

### Size goals
- Current AE ISO baseline: ~3.2 GB
- Target persistent live USB ISO: ideally under 2.0 GB, stretch target 1.4–1.8 GB
- Target qcow2 compressed artifact: materially smaller than current full-Ubuntu path

### Functional goals
- Ubuntu 24.04 package compatibility preserved
- AE bootstrap + verify still succeed
- persistence still survives reboot
- live lane does not depend on subiquity or snap seeding
- core operator tools still available:
  - git
  - zsh
  - tmux
  - curl
  - jq
  - ripgrep
  - fd-find
  - sqlite3
  - python3
  - python3-venv
  - nodejs
  - npm
  - gh
- optional services remain layered, not forced into every image

### Anti-goals
- no full desktop environment by default
- no Enlightenment/Bodhi-specific dependency tree unless there is a concrete reason
- no “Ubuntu live-server remaster but slightly edited” as the final architecture

---

## Proposed base model

### Base distro identity
Use Ubuntu Noble repositories directly.

### Base build style
Build rootfs from scratch with:
- preferred: `mmdebstrap`
- fallback: `debootstrap`

### Package classes

#### Tier 0: absolute base
- bash
- coreutils
- ca-certificates
- apt
- systemd
- openssh-server
- sudo
- curl
- wget
- gnupg
- xz-utils
- squashfs-tools

#### Tier 1: AE core substrate
- git
- zsh
- tmux
- jq
- ripgrep
- fd-find
- sqlite3
- python3
- python3-venv
- python3-pip
- nodejs
- npm
- gh

#### Tier 2: optional overlays
- docker
- desktop/browser bits
- local model runtimes
- any GUI stack

Policy:
- Tier 0 + Tier 1 define the minimal AE identity
- Tier 2 is opt-in only

---

## Concrete implementation plan

### Task 1: Record the current heavyweight baseline

Objective: capture exactly what is making the current AE images large so future reductions are measurable.

Files:
- Create: `docs/plans/ae-minimal-ubuntu-baseline-notes.md`
- Modify: `scripts/build-agent-edition-live-usb.sh` only if adding debug output is necessary

Step 1: inventory current image inputs
- note that current build script starts from `ubuntu-24.04.2-live-server-amd64.iso`
- note the current artifact size from the JSON metadata
- list installer/live baggage observed in boot logs: subiquity, snapd, snapd.seeded

Step 2: capture baseline metrics
- ISO size
- current package/tool expectations from `scripts/lib/bootstrap-common.sh`
- current bundle identity from `lib/workbench.ts`

Verification:
- document contains current size baseline and current package contract

Commit:
- `docs: capture current AE image baseline`

---

### Task 2: Define the true minimal Ubuntu AE contract

Objective: freeze the exact package/service contract for the new base.

Files:
- Create: `docs/plans/ae-minimal-ubuntu-package-contract.md`
- Modify: `scripts/lib/bootstrap-common.sh`
- Modify: `lib/workbench.ts`

Step 1: split package lists into tiers
- define required packages vs optional overlays
- explicitly mark docker as optional overlay unless a lane truly requires it in-base

Step 2: update operator philosophy docs
- replace any vague “Ubuntu minimal” language with explicit contract
- make clear that AE is Ubuntu Noble package-compatible and Bodhi-like only in footprint/philosophy

Verification:
- package contract doc lists required packages and justified optional overlays

Commit:
- `docs: define minimal Ubuntu AE package contract`

---

### Task 3: Add a new rootfs builder entrypoint

Objective: create a script that builds a minimal Ubuntu Noble rootfs directly from repos.

Files:
- Create: `scripts/build-agent-edition-rootfs.sh`
- Create: `scripts/lib/rootfs-common.sh`
- Test: `tests/minimal-rootfs-lane.test.ts`

Step 1: write failing tests
Tests should assert script presence and expected strings:
- `mmdebstrap` or `debootstrap`
- Ubuntu Noble / 24.04
- minimal package list reference
- output directory contract

Step 2: implement rootfs builder
Command shape example:
- `bash scripts/build-agent-edition-rootfs.sh --bundle solo-builder-core --channel stable --output-dir output/rootfs-noble-minimal`

Builder responsibilities:
- build Ubuntu Noble rootfs
- install Tier 0 + Tier 1 packages only
- inject freshcrate scripts
- emit build receipt

Verification:
- rootfs directory created
- package manifest emitted
- tests pass

Commit:
- `feat: add minimal Ubuntu rootfs builder`

---

### Task 4: Make qcow2 build consume the minimal rootfs

Objective: stop treating the qcow2 lane as a derivative of a larger image path.

Files:
- Modify: `scripts/build-agent-edition-image.sh`
- Modify: `scripts/provision-agent-edition-image.sh`
- Modify: `tests/workbench-install.test.ts`

Step 1: allow qcow2 path to import or assemble from the minimal rootfs
Step 2: keep existing artifact contracts stable where possible
Step 3: update tests if command strings or receipts change

Verification:
- qcow2 lane still builds
- qcow2 lane uses minimal rootfs contract
- targeted tests pass

Commit:
- `refactor: point qcow2 lane at minimal Ubuntu rootfs`

---

### Task 5: Rebuild the live USB lane on the minimal rootfs

Objective: make the persistent live USB lane small by removing installer-only baggage.

Files:
- Modify: `scripts/build-agent-edition-live-usb.sh`
- Modify: `images/cloud-init/iso-live-persistent-x86_64/user-data`
- Modify: `tests/live-usb-image-lane.test.ts`

Step 1: stop inheriting the full Ubuntu live-server root as the long-term design
Step 2: build a squashfs from the minimal rootfs
Step 3: keep only the bootloader/live boot pieces needed for casper persistence
Step 4: preserve current verified persistence behavior

Verification:
- live USB still boots in QEMU
- persistence verifier still passes
- ISO size drops materially versus current ~3.2 GB baseline

Commit:
- `feat: rebuild live USB lane on minimal Ubuntu rootfs`

---

### Task 6: Make the installer lane an explicit separate concern

Objective: keep autoinstall from dictating the architecture of every other lane.

Files:
- Modify: `scripts/build-agent-edition-iso.sh`
- Modify: `tests/iso-image-lane.test.ts`
- Create: `docs/plans/ae-installer-lane-separation.md`

Step 1: document that installer lane is intentionally separate from live USB lane
Step 2: decide whether installer lane stays on Ubuntu live-server short term
Step 3: ensure release/download metadata does not imply the live lane needs installer components

Verification:
- tests still pass
- docs clearly separate installer media from live persistent media

Commit:
- `docs: separate installer and live AE architecture`

---

### Task 7: Add size-budget enforcement

Objective: prevent silent regression back to bloated images.

Files:
- Create: `scripts/check-agent-edition-size-budget.sh`
- Modify: `.github/workflows/build-agent-edition-iso-image.yml`
- Modify: live USB workflow when added/published
- Test: `tests/minimal-rootfs-lane.test.ts`

Step 1: define budgets
- live USB ISO max size target
- qcow2 compressed artifact target

Step 2: fail CI when artifact exceeds budget unless explicitly overridden

Verification:
- script exits non-zero when a budget is exceeded
- workflow calls the script

Commit:
- `ci: add AE image size budgets`

---

### Task 8: Publish exact operator positioning

Objective: explain the new base simply.

Files:
- Create: `docs/agent-edition-minimal-ubuntu.md`
- Modify: `app/install/agent-edition/page.tsx`
- Modify: `app/workbench/page.tsx`

Required messaging:
- “Ubuntu 24.04 package compatible”
- “Bodhi-like footprint, not Bodhi-derived distro identity”
- “Headless first”
- “Live USB and installer are separate products”

Verification:
- docs/UI reflect the new architecture and tradeoffs

Commit:
- `docs: explain minimal Ubuntu AE architecture`

---

## Recommendation on Bodhi specifically

Use Bodhi only as inspiration, not as the real base.

Why not Bodhi as the base:
- you said you want Ubuntu 24.04 package compatibility first
- Bodhi’s value is the tiny/default UX approach, not some magical size advantage you can inherit without tradeoffs
- you do not want Enlightenment anyway

Best interpretation of your ask:
- “Ubuntu Noble package universe, Bodhi-like minimalism”

That means:
- Ubuntu rootfs you build yourself
- no heavy desktop
- no installer ballast in live media
- only AE core packages by default

---

## Immediate next build strategy

If I were executing this now, I would do it in this order:
1. rootfs builder
2. package contract cleanup
3. qcow2 on minimal rootfs
4. live USB on minimal rootfs
5. size-budget CI
6. installer-lane cleanup later

Reason:
- qcow2 + live USB are where the win is
- installer lane can stay ugly longer if necessary

---

## Exact next command-level work I would do next

1. add `scripts/build-agent-edition-rootfs.sh`
2. add `tests/minimal-rootfs-lane.test.ts`
3. wire a new `package.json` script:
   - `image:build:rootfs`
4. make `bootstrap-common.sh` expose required vs optional package tiers
5. re-point live USB lane at the custom rootfs instead of Ubuntu live-server payload

---

## Final opinion

You are asking for the right thing.

The correct move is not “switch to Bodhi.”
The correct move is:
- keep Ubuntu 24.04 packages
- abandon the stock Ubuntu live-server ISO as the default AE substrate
- build your own minimal Noble base
- keep the AE identity as a thin operator layer

That gets you what you actually want.
