---
id: APP-251
title: Port the attended-approval launch key to Windows
priority: P3
effort: L
component: desktop-app
status: ideation
related: [CLI-017, APP-252, APP-253, APP-254]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-10-28
---

## Problem

The desktop app proves an approval came from the owner with a launch key file (state.cjs:16,53-70;
cli.py:1838-1910). The trust checks are POSIX-only: uid, exact mode 0600/0700, O_NOFOLLOW, dir_fd,
st_nlink, ~/Library. On Windows, LaunchKey.trust() throws at startup (process.getuid is undefined), and
_owned() would reject every key, so no owner decision could be recorded.


## Proposed approach

On Windows, serve the key over a per-user named pipe (\\.\pipe\lore-attended-<user SID>) from the main
process. The CLI verifies the pipe server's PID is the Lore executable (GetNamedPipeServerProcessId +
QueryFullProcessImageName) and reads the key. Keep the file mechanism on macOS. Alternative: an
owner-only DACL folder in %LOCALAPPDATA%, rejecting reparse points and checking the owner SID via ctypes.
Threat-model it against the sandboxed agent (srt-win's sandbox user must not be able to open the pipe).


## Acceptance criteria

- [ ] App starts on Windows; approvals from the app succeed
- [ ] A process running as the srt-win sandbox user cannot obtain the key (test)
- [ ] A copied or forged key file / spoofed pipe is refused (test)
- [ ] macOS path unchanged and its tests green

## Notes

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.
