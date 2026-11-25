# This fork

[Omar-Tnzxo/agent-office](https://github.com/Omar-Tnzxo/agent-office) is [AgentSystemLabs/agent-office](https://github.com/AgentSystemLabs/agent-office) plus three features (the first two offered upstream in [AgentSystemLabs/agent-office#405](https://github.com/AgentSystemLabs/agent-office/pull/405)):

- **Subagents at the desk.** A Claude Code worker's subagents (the Agent tool, a workflow's agents) stand round its chair while they run.
- **Visitors.** Claude Code sessions the office didn't start (the Claude desktop app, a terminal, an IDE) show up on the floor whose repository they work in, with their subagents round them: one at work walks from the elevator to a desk no worker has and sits there typing, and walks back to the lobby when its turn is over. Workers come first, so hiring at a visitor's desk moves the visitor. Read-only; `--no-visitors` turns them off.

- **Handoffs and the review table.** On a floor whose repository keeps its work as tickets (`work/<id>/ticket.md`: front matter and a chain log of handoffs), a visitor that hands a ticket on walks a folder over to whoever takes it next and gives it to them face to face, each seated visitor has an in-tray of the tickets waiting on its role, and a review table by the meeting room holds what's in review and what waits on the owner, with **E** to read them. Read-only, and only on a floor whose files are in that format.

See [docs/features.md](docs/features.md) and [docs/how-it-works.md](docs/how-it-works.md) for all three.

## Install and update

```bash
curl -fsSL https://raw.githubusercontent.com/Omar-Tnzxo/agent-office/main/install.sh | bash
```

Run the same line again to update. It installs this fork's newest release (`v0.1.<n>-omar`), not upstream's: the official install line would put upstream's back, without the two features. `AGENT_OFFICE_REPO=AgentSystemLabs/agent-office` makes this install.sh fetch upstream's releases instead.

## Following upstream

`.github/workflows/sync-upstream.yml` merges upstream's `main` into this fork's `main` every 6 hours (or from the Actions tab, **Sync upstream** → **Run workflow**). When the merge is clean and the build and tests pass, it pushes and has `release.yml` publish a release, so the line above picks it up. When it isn't (a conflict with the fork's changes, failing tests, or an upstream change to `.github/workflows`, which the workflow's token may not push), nothing is published and an issue titled *Upstream sync needs a hand* is opened: merge `upstream/main` into `main` by hand, then run the workflow again.

What only this fork changes, besides the two features: `install.sh` fetches releases from this repository, `release.yml` adds `-omar` to the version, and this file and `sync-upstream.yml`. Once upstream merges #405, the features come back to this fork through the sync like any other upstream change.

GitHub turns off a scheduled workflow in a repository with no activity for 60 days; the Actions tab turns it back on.
