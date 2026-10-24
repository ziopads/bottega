# The Mac watcher

A small program that runs on the Mac from login, watches the Ableton sessions
folder, and sends every set Live saves to Bottega, with the project folder's
file list, as you (REQUIREMENTS A-9 to A-12). It does what dropping the folder on a
project's State tab does, without the drop. Only the description of a set goes
up, never audio.

## Setting it up

In Bottega, Account › Security › Mac watcher:

1. **Add a Mac.** Give it a name ("Studio Mac") and its sessions folder: the
   folder whose subfolders are the Live project folders. To get the path, select
   the folder in Finder, Control-click it, hold Option, and choose "Copy … as
   Pathname". A folder dragged into Terminal (with backslashes) or a quoted path
   is cleaned up too. A laptop and a studio Mac can each have their own folder.

2. **Run the install command** it shows, in Terminal on that Mac:

   ```
   curl -fsSL https://<bottega>/watcher/install.sh | bash -s -- --server https://<bottega> --code K7QX-M2PL
   ```

   The code works once, for fifteen minutes. The installer
   (`public/watcher/install.sh`) puts everything in
   `~/Library/Application Support/Bottega Watcher`, with no administrator rights:

   - Node.js 22 from nodejs.org, checked against nodejs.org's published SHA-256
     checksums (skipped when a 22 is already there);
   - the watcher, one file built from this repository on every deploy
     (`/watcher/bottega-watcher.cjs`);
   - a `bottega-watcher` command beside them.

   It then trades the code for this Mac's own token, kept in the login keychain
   (as "Bottega Watcher"), and starts the watcher at login (a LaunchAgent,
   `com.sirsinate.bottega-watcher`). The token is never shown anywhere.

To **change the folder**, edit the Mac in Bottega: the watcher reads its name
and folder from Bottega at every start and every ten-minute sweep.
**Install again** gives a new code (for a new Mac, a wiped one, or after a
token was refused); the Mac's old token stops working when the new code is
used. **Remove** stops the Mac's token at once.

To **update** the watcher after a deploy, run the installer without `--code`:

```
curl -fsSL https://<bottega>/watcher/install.sh | bash -s -- --server https://<bottega>
```

## Day to day

```
"$HOME/Library/Application Support/Bottega Watcher/bottega-watcher" status      what waits, what failed, folders with no project
"$HOME/Library/Application Support/Bottega Watcher/bottega-watcher" once        read every folder now, then stop
"$HOME/Library/Application Support/Bottega Watcher/bottega-watcher" uninstall   stop, and no longer start at login
```

The log is `~/Library/Application Support/Bottega Watcher/watcher.log`, beside
`config.json` and `state.json`. Each Mac's last report (when it was last
heard from, whether it found its folder, what waits, folders with no project)
shows under its name in Account › Security.

## Working on the watcher

`npm run watcher:build` compiles `watcher/main.ts` and `lib/als` with the
repository's TypeScript into `watcher/dist`, then `scripts/watcher-bundle.mjs`
joins them into `public/watcher/bottega-watcher.cjs` (ignored by git;
`npm run build` makes it on every deploy). From the repository,
`node watcher/dist/watcher/main.js <command>` runs it directly; `setup` still
signs it in by hand with a token made before Macs (version 1.0).
`BOTTEGA_WATCHER_HOME` and `BOTTEGA_WATCHER_TOKEN` stand in for the folder and
the keychain when trying it away from a Mac.

## What it does

- Watches the sessions folder. Ten seconds after the last change in a project
  folder, and once Live has finished writing, it reads the folder: every saved
  set at its top (not Backup/) that Bottega does not have yet goes up, then the
  file list when it changed.
- Every ten minutes it looks at every folder again, which also catches anything
  missed while the drive was away.
- **Offline:** sets that cannot be sent wait in `state.json`, with the
  projects as last listed so folders are still matched, and go, oldest first,
  as soon as Bottega answers (it tries every minute). Nothing is lost by
  quitting or restarting.
- **Finding the project:** the folder name last dropped on a project's State
  tab, else the date the folder name starts with matched to the project's
  canonical id ("2025 0727 khione Project" → 2025 0727). A folder that matches
  no project, or more than one, is listed in `status` and under Account ›
  Security, never guessed or created. Making the project, or dropping the
  folder once on its State tab, settles it.
- **Refused sets** (too large, or not a Live set) are listed in `status` and
  tried again only when the file changes.
- The token can send sets and file lists, and read its Mac's name and
  folder, nothing else. Removing the Mac under Account › Security stops the
  watcher at once.
