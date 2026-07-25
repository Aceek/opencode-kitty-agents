# Gate 0 Live Probe

This directory is test-only. It does not implement the production session
tracker, presentation adapter, or broker.

## Exact Kitty Mapping

Add this one line to `kitty.conf`, changing only the key chord if it conflicts:

```conf
map ctrl+shift+f12 launch --type=background --allow-remote-control --remote-control-password '!' --remote-control-password '"" ls launch close-window' /home/aceek/.bun/bin/bun /home/aceek/projects/opencode-kitty-agents/test/gate0/broker.ts @active-kitty-window-id
```

The empty, window-local password is restricted to `ls`, `launch`, and
`close-window`. Every broker invocation adds `--use-password=never`. Global
Kitty remote control must remain disabled.

## Manual Live Test

1. Run `bun run check` in the repository.
2. Add the mapping above and reload `kitty.conf` (or restart Kitty).
3. In a Kitty tab using the `splits` layout, press `ctrl+shift+f12` once.
4. Wait for the newly launched OpenCode window to finish loading the test-only
   server plugin probe. The harmless `/usr/bin/sleep 30` split may appear
   briefly and is closed by the broker in a `finally` path.
5. From another shell, run `bun run gate0:result`. Success is a versioned JSON
   object containing only boolean proof fields. It contains no endpoint,
   descriptor, window ID, environment, command line, Kitty JSON, or credential.
6. Confirm that both windows created by the test close automatically, then
   remove the mapping and reload `kitty.conf`.

The broker explicitly maps the inherited Kitty descriptor to the same child FD
in every `Bun.spawn` call. The unit test named `preserves a high inherited
descriptor` verifies this Bun behavior without requiring Kitty.
