# The Mac watcher

A small program that runs on the Mac from login, watches the Ableton sessions
folder, and sends every set Live saves to Bottega, with the project folder's
file list, as you (REQUIREMENTS A-9). It does what dropping the folder on a
project's State tab does, without the drop. Only the description of a set goes
up, never audio.

## Setting it up

From the repository folder:

1. Build it (again after each pull that changes `watcher/` or `lib/als/`):

   ```
   npm run watcher:build
   ```

2. In Bottega, Account › Security › Mac watcher: name a token ("Studio Mac")
   and press Make a token. Copy the token; it is shown once.

3. Set the watcher up: it asks for Bottega's address, the sessions folder, and
   the token, which it keeps in your login keychain (as "Bottega Watcher").

   ```
   node watcher/dist/watcher/main.js setup
   ```

4. Start it at login, and now:

   ```
   node watcher/dist/watcher/main.js install
   ```

If Node moves (a new version from Homebrew or nvm), run `install` again: the
LaunchAgent names the Node it was installed with.

## Day to day

```
node watcher/dist/watcher/main.js status      what waits, what failed, folders with no project
node watcher/dist/watcher/main.js once        read every folder now, then stop
node watcher/dist/watcher/main.js uninstall   stop, and no longer start at login
```

The log is `~/Library/Application Support/Bottega Watcher/watcher.log`, beside
`config.json` and `state.json`.

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
- The token can send sets and file lists, nothing else. Revoking it under
  Account › Security stops the watcher at once.
