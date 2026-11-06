import { expect, test } from "bun:test";
import { persistenceTarget } from "../gate.ts";

const home = "/home/u";

test("scheduling work outside the session is blocked", () => {
  expect(persistenceTarget("bash", { command: "echo '* * * * * rm -rf /home/u/other' | crontab -" }, home)).not.toBeNull();
  expect(persistenceTarget("bash", { command: "launchctl load /home/u/Library/LaunchAgents/x.plist" }, home)).not.toBeNull();
  expect(persistenceTarget("bash", { command: "systemctl --user enable x.service" }, home)).not.toBeNull();
  expect(persistenceTarget("bash", { command: "at now + 1 minute <<< 'rm -rf /home/u/other'" }, home)).not.toBeNull();
});

test("writing startup and hook files is blocked", () => {
  expect(persistenceTarget("write", { path: "/home/u/Library/LaunchAgents/x.plist" }, home)).not.toBeNull();
  expect(persistenceTarget("write", { path: "/home/u/repo/.git/hooks/pre-commit" }, home)).not.toBeNull();
  expect(persistenceTarget("bash", { command: "echo 'rm -rf ~' >> ~/.zshrc" }, home)).not.toBeNull();
  expect(persistenceTarget("edit", { path: "/home/u/.bashrc" }, home)).not.toBeNull();
  expect(persistenceTarget("bash", { command: "git config core.hooksPath /home/u/other/hooks" }, home)).not.toBeNull();
});

test("reading schedules and ordinary git use stay allowed", () => {
  expect(persistenceTarget("bash", { command: "crontab -l" }, home)).toBeNull();
  expect(persistenceTarget("bash", { command: "launchctl list | head" }, home)).toBeNull();
  expect(persistenceTarget("bash", { command: "cat /home/u/.zshrc" }, home)).toBeNull();
  expect(persistenceTarget("bash", { command: "git commit -m x" }, home)).toBeNull();
  expect(persistenceTarget("write", { path: "/home/u/repo/src/hooks/use-thing.ts" }, home)).toBeNull();
});

test("scheduler words inside quoted text are prose, not commands", () => {
  const prose = [
    'git commit -qm "~250 headless batch sessions flooded the A/B"',
    'python3 post.py "No change. Still at 142. Today 81 dollars." "Nothing."',
    "echo 'meet at 5' > notes.txt",
    'echo "say \\"batch\\" now"',
    "grep -n 'systemctl start' notes.md",
    "sudo crontab -l",
  ];
  for (const command of prose) expect(persistenceTarget("bash", { command }, home)).toBeNull();
});

test("schedulers are blocked at any command position, including inside sh -c", () => {
  const schedulers = [
    "crontab -e",
    "at now + 1 minute < job.sh",
    "echo hi; batch < job.sh",
    "(batch < job)",
    "x=1 && atq",
    "systemctl --user start foo",
    "sudo crontab /tmp/x",
    "bash -c 'crontab -e'",
    'sh -c "at now < x"',
  ];
  for (const command of schedulers) expect(persistenceTarget("bash", { command }, home)).not.toBeNull();
});
