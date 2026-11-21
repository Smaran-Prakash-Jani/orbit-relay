# Relay build path

## Current slice: permission repair and support handoff

The first usable workflow is Flatpak user permission inspection, reset, and undo. This is a narrow repair: it affects one installed application and never changes system-wide permissions or application data. Relay also checks the PipeWire user service and can prepare a small support report when the cause needs human investigation.

Success criteria for this slice:

- A newcomer can find an app with a permission problem and understand what resetting will affect.
- A repair can be undone after the app is closed and reopened.
- The support report is previewable and contains no raw logs, command output, app names, paths, addresses, or account identifiers.

## Next: high confidence repair recipes

Add focused diagnostics for desktop portal/screen sharing, audio device profiles, Bluetooth routing, and package manager health. Each recipe needs a supported environment check, a plain explanation, a change preview, a way back where meaningful, and a post-change check. Avoid general shell-command execution.

## Then: setup blueprint

Record installed apps and sources, desktop settings, and selected app configuration. Build a reviewed restore plan for another Linux installation, with clear skips where settings cannot safely move between desktop environments or distributions.

## Later: activity profiles

Gaming, streaming, travel, and focus profiles should check relevant prerequisites and apply only reversible settings. Validate demand with users before building a large profile catalog.
