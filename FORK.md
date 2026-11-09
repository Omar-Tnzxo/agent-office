# This fork

[Omar-Tnzxo/agent-office](https://github.com/Omar-Tnzxo/agent-office) is [AgentSystemLabs/agent-office](https://github.com/AgentSystemLabs/agent-office) plus two features, offered upstream in [AgentSystemLabs/agent-office#405](https://github.com/AgentSystemLabs/agent-office/pull/405):

- **Subagents at the desk.** A Claude Code worker's subagents (the Agent tool, a workflow's agents) stand round its chair while they run.
- **Visitors.** Claude Code sessions the office didn't start (the Claude desktop app, a terminal, an IDE) wait in the lobby of the floor whose repository they work in, with their subagents round them. Read-only; `--no-visitors` turns them off.

See [docs/features.md](docs/features.md) and [docs/how-it-works.md](docs/how-it-works.md) for both.

## Install and update

```bash
curl -fsSL https://raw.githubusercontent.com/Omar-Tnzxo/agent-office/main/install.sh | bash
```

Run the same line again to update. It installs this fork's newest release (`v0.1.<n>-omar`), not upstream's: the official install line would put upstream's back, without the two features. `AGENT_OFFICE_REPO=AgentSystemLabs/agent-office` makes this install.sh fetch upstream's releases instead.

## Following upstream

`.github/workflows/sync-upstream.yml` merges upstream's `main` into this fork's `main` every 6 hours (or from the Actions tab, **Sync upstream** → **Run workflow**). When the merge is clean and the build and tests pass, it pushes and has `release.yml` publish a release, so the line above picks it up. When it isn't (a conflict with the fork's changes, failing tests, or an upstream change to `.github/workflows`, which the workflow's token may not push), nothing is published and an issue titled *Upstream sync needs a hand* is opened: merge `upstream/main` into `main` by hand, then run the workflow again.

What only this fork changes, besides the two features: `install.sh` fetches releases from this repository, `release.yml` adds `-omar` to the version, and this file and `sync-upstream.yml`. Once upstream merges #405, the features come back to this fork through the sync like any other upstream change.

GitHub turns off a scheduled workflow in a repository with no activity for 60 days; the Actions tab turns it back on.
