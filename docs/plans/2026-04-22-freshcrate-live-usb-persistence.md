# Freshcrate Live USB Persistence Plan

> For Hermes: use this as the design brief for a separate live-USB lane. Do not overload the existing autoinstall ISO lane.

Goal: add a true x86_64 live USB mode for Freshcrate Agent Edition that boots directly from USB, preserves state across reboots, and can be used by agents as a portable operating environment.

Architecture: keep the current `iso-autoinstall-headless` lane as an installer-only product. Add a new `iso-live-persistent-x86_64` lane built around Ubuntu live media + casper persistence (`persistent` with `casper-rw` / writable overlay). Treat persistence storage as a second partition or writable image created on the USB device after flashing.

Tech stack: Ubuntu live media, casper overlay/persistence, xorriso, cloud-init/live config, QEMU validation, existing freshcrate packaging/bootstrap scripts.

---

## Grounded findings

1. Current ISO is installer-first, not live-session-first.
   - `images/cloud-init/iso-autoinstall-headless/user-data` starts with `autoinstall:` and uses curtin late-commands into `/target`.
   - `scripts/build-agent-edition-iso.sh` injects `autoinstall ds=nocloud;s=/cdrom/nocloud/` into boot config.
   - `scripts/qemu-install-verify-agent-edition-iso.sh` verifies unattended install to disk, then boots the installed disk.

2. Ubuntu casper supports persistence in the live environment.
   - Noble `casper(7)` says `persistent` looks for partitions/files labeled `casper-rw`, `home-rw`, etc.
   - `persistent-path=` is supported.
   - casper provides writable overlay on top of the read-only live root.

3. Strong recommendation:
   - do not mutate the current installer lane into a dual-purpose live+installer lane first.
   - add a separate lane with separate tests, docs, and packaging.

---

## Product intent for live mode

The new live USB mode should:
- boot directly into a usable agent environment from USB
- preserve agent state and workspace across reboots
- avoid mandatory install-to-disk
- allow optional later install-to-disk if desired
- be explicit about persistence capacity and wear tradeoffs

Likely use cases:
- portable agent workstation
- incident-response / field ops USB
- temporary but durable lab environment
- bring-your-own-hardware agent runtime

---

## Recommended product shape

### Lane A — keep existing
- `iso-autoinstall-headless`
- purpose: unattended installer
- current behavior stays unchanged

### Lane B — add new
- `iso-live-persistent-x86_64`
- purpose: true live USB with persistence
- boots to live session
- persistence stored on a separate writable partition or image on the USB stick

Do not ship Lane B until it has its own validation path.

---

## Key design decision

### Recommended persistence model: separate writable partition on USB

Use:
- Partition 1: flashed ISO/hybrid boot media
- Partition 2: ext4 labeled `casper-rw`
- optional Partition 3: data/workspace partition if needed later

Why this is best:
- simplest mental model
- aligns with casper persistence behavior
- avoids FAT32 file-size limits of loop files
- easier to resize/repair than embedded loopfile tricks
- better for larger persistent agent state

Avoid as primary design:
- loopfile persistence inside a FAT partition
- trying to reuse autoinstall nocloud mechanics as the persistence path

---

## Runtime expectations

On first live boot:
- casper mounts read-only live root
- casper overlays writable state from `casper-rw`
- Freshcrate bootstrap runs in the live environment, not in `/target`
- agent home/state/workspace are initialized if missing

On subsequent boots:
- prior state returns from persistence overlay
- package installs, configs, logs, and agent workspace survive reboot

Potential persistence targets:
- `/home/freshcrate`
- `/opt/freshcrate/home`
- `/opt/freshcrate/workspace`
- agent receipts/logs/cache as appropriate

---

## Constraints / risks

1. USB wear
- live persistent mode writes a lot more than install media
- document that good USB SSD / fast flash is preferred

2. Overlay growth
- large model caches/logs can fill persistence quickly
- impose sensible defaults and cleanup guidance

3. Update model
- updating the live base image is different from updating installed systems
- treat it as image replacement + state migration problem later

4. Secure boot / firmware behavior
- validate BIOS and UEFI both
- preserve current bootability discipline

5. Existing autoinstall injection must not leak into live mode
- current boot flags force unattended install
- live lane must have distinct boot menu entries and kernel args

---

## Implementation slices

### Slice 1: separate live lane metadata + artifact contract

Objective: create a clearly separate image identity before changing behavior.

Files:
- Modify: `lib/workbench.ts`
- Modify: `package.json`
- Modify: `scripts/package-agent-edition-image.sh`
- Add tests: `tests/live-usb-image-lane.test.ts`

Requirements:
- new image name: `iso-live-persistent-x86_64`
- distinct artifact name, e.g. `freshcrate-live-agent-x86_64.iso`
- package.json commands:
  - `image:build:liveusb`
  - `image:smoke:liveusb`
  - `image:verify:liveusb`
- packaging must not collide with autoinstall lane outputs

Verification:
- tests assert image lane is present
- build/package command strings include new lane name

---

### Slice 2: build script for live ISO boot config

Objective: stop forcing autoinstall and produce a real live-session boot path.

Files:
- Add: `scripts/build-agent-edition-live-usb.sh`
- Add: `images/cloud-init/iso-live-persistent-x86_64/` as needed
- Reuse carefully from `scripts/build-agent-edition-iso.sh`

Requirements:
- start from Ubuntu live media
- inject Freshcrate scripts/assets into ISO
- DO NOT inject `autoinstall ds=nocloud...`
- instead add live boot entries with `boot=casper persistent` support
- document required second partition label: `casper-rw`

Important:
- likely no curtin `/target` flow
- bootstrap must run against the live root on first boot or via systemd oneshot in the live environment

Verification:
- inspect generated grub/isolinux config for `persistent`
- ensure no forced `autoinstall` parameter exists

---

### Slice 3: first-boot live bootstrap path

Objective: initialize the agent environment inside the live OS.

Files:
- Modify/add live bootstrap runner (likely new script)
- Possibly add a systemd unit inside the ISO payload
- Reuse existing bootstrap/verify logic only where safe for live root

Requirements:
- if `/opt/freshcrate/home` or equivalent is empty, initialize defaults
- persist state onto overlay
- do not assume installed target disk exists
- keep idempotent behavior

Likely approach:
- new live-specific provision script, separate from install-time provision script
- new systemd oneshot service on boot that checks marker/receipt and initializes once

Verification:
- boot twice in QEMU with persistence attached
- verify marker file persists
- verify home/workspace/receipts persist

---

### Slice 4: USB persistence creation helper

Objective: make the operator flow real, not theoretical.

Files:
- Add: `scripts/create-live-usb-persistence.sh`
- Add docs

Requirements:
- given a USB device, create ext4 persistence partition labeled `casper-rw`
- optionally size it interactively or by flag
- refuse dangerous devices unless explicitly confirmed
- print resulting partition layout

Possible command shape:
- `bash scripts/create-live-usb-persistence.sh --device /dev/sdX --size 40G`

Verification:
- script dry-run mode
- manual check with `lsblk -f`

---

### Slice 5: QEMU validation for true persistence

Objective: prove persistence actually works.

Files:
- Add: `scripts/qemu-smoke-test-live-usb.sh`
- Add: `scripts/qemu-verify-live-usb-persistence.sh`
- Add tests for script presence/contract

Requirements:
- boot ISO with an attached writable `casper-rw` disk/partition image
- create sentinel file in live session
- reboot
- verify sentinel persists
- verify agent receipts/state persist

Verification criteria:
- BIOS boot passes
- UEFI boot passes
- persistence survives reboot
- bootstrap only runs once or remains idempotent

---

### Slice 6: docs + operator positioning

Objective: make product intent clear.

Files:
- Add: docs for live USB creation/use
- Update: `app/agent-edition/page.tsx` only after the lane is real
- Update: `app/api/page.tsx` when endpoints/metadata are real

Documentation must explain:
- installer ISO vs live USB ISO
- persistence partition requirement
- expected storage performance
- where state lives
- known limitations

---

## Verification matrix

Minimum ship bar for live USB mode:
- build script completes
- BIOS boot works
- UEFI boot works
- live environment starts without installing to disk
- persistence survives reboot
- freshcrate bootstrap receipts persist
- docs show exact USB creation steps

Nice-to-have before wider launch:
- optional install-to-disk from live mode
- encrypted persistence
- partition-resize helper
- upgrade/migration story

---

## Recommendation

Build this as a new lane.

Do not overload the current autoinstall ISO.

Best immediate next implementation target:
1. Slice 1 — lane/artifact contract
2. Slice 2 — live boot build script
3. Slice 5 — persistence verification in QEMU
4. Slice 4 — USB persistence helper
5. Slice 3 — polish bootstrap behavior
6. Slice 6 — docs/UI

This feature is genuinely valuable for agents because it creates a portable durable runtime, but only if persistence is first-class and verified rather than hand-wavy.
