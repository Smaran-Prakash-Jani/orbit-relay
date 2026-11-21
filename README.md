# Orbit Relay

Your Linux setup, repairable and portable. Relay is a local desktop companion for understanding common problems and applying narrowly scoped, reviewable repairs.

The interface shares Orbit's warm translucent dashboard appearance. The frameless window shows your actual desktop through its clear corners and glass panels. Use the top bar slider to set transparency from 0% to 80%; Relay remembers your choice locally. The app contains no wallpaper or theme picker.

![Orbit Relay's translucent overview](docs/overview-glass.png)

## Download

Get the latest build from the [Releases page](https://github.com/Smaran-Prakash-Jani/orbit-relay/releases/latest):

- `Orbit-Relay-<version>-linux-amd64.deb` for Debian, Ubuntu and their derivatives:

  ```bash
  sudo apt install ./Orbit-Relay-<version>-linux-amd64.deb
  ```

- `Orbit-Relay-<version>-linux-x86_64.AppImage` for other x86-64 distributions (may need your distribution's FUSE package):

  ```bash
  chmod +x Orbit-Relay-<version>-linux-x86_64.AppImage
  ./Orbit-Relay-<version>-linux-x86_64.AppImage
  ```

After installing the `.deb`, open **Orbit Relay** from the application menu under System. The packages are unsigned.

## First release

- Detects distribution, desktop, session, Flatpak and user audio service status.
- Shows the count of Flatpak apps with user permission changes in the overview.
- Shows installed Flatpak applications with user permission overrides.
- Previews the exact per-app override file before resetting that app's **user** overrides. Makes a private backup and offers undo. System-wide overrides and application data are untouched.
- Exports a previewable support report. It omits usernames, hostnames, paths, network addresses, app names, logs, and command output.

Relay currently supports Linux desktop sessions. Flatpak repair needs the `flatpak` command and applies only to user overrides. Audio checks need a systemd user session. Unsupported checks stay unknown.
Restart the affected Flatpak app after a reset. Undo copies are kept in Relay's private application data directory so undo remains available after reopening the app.

The [build path](docs/ROADMAP.md) describes the next repair packs, setup blueprint, and activity profiles.

## Build from source

Requires Node.js 22.12+ and a Linux graphical desktop.

```bash
npm ci
npm run build:linux
npm run install:user
```

`npm start` runs the source checkout for development. `npm run install:user` installs for your user only, without root: a versioned copy under `~/.local/opt/orbit-relay/` and an application-menu entry under `~/.local/share/applications/`.
To refresh an existing installed version after rebuilding, run `npm run install:user:replace`; the installer stages the new files and restores the previous copy if installation fails.

For checks without a graphical session:

```bash
npm run check
npm test
npm run test:desktop
```

The renderer is sandboxed. It receives only validated results through fixed IPC handlers. The app makes no network requests. More repair recipes and a portable setup blueprint are planned after this first workflow is validated with users.
