/**
 * What the server says that the page shows as its own words: toasts ("Omar sent Ada home"), and the
 * errors of signing in or of a request. The server speaks English to everyone, so on an Arabic page
 * each message is matched against RULES and said again in Arabic, its names and numbers carried
 * over; one no rule knows stays as the server wrote it. Agent output never comes through here.
 *
 * How to add one: a rule with the server's words as a pattern (anchored, the names as groups), the
 * key it becomes, and what each group is called in that key's {holes}; then the key in
 * strings/server.ts, in both languages. The first rule that matches wins, so a longer message goes
 * before a shorter one it starts with ("hired Ada for issue #3" before "hired Ada").
 */
import { lang, t, type TextKey } from '.';

type Rule = readonly [pattern: RegExp, key: TextKey, holes: readonly string[]];

/**
 * A pattern with the server's long dash in it, written <D> here (strings in this repo never hold
 * that character itself).
 */
const LONG_DASH = String.fromCharCode(0x2014);
const dashed = (re: RegExp) => new RegExp(re.source.replace('<D>', LONG_DASH), re.flags);

const RULES: readonly Rule[] = [
  // Hiring, sending home, worktrees.
  [/^(.+?) hired (.+?) for issue #(\d+) across (.+)$/, 'server.hiredIssueAcross', ['who', 'name', 'n', 'repos']],
  [/^(.+?) hired (.+?) for issue #(\d+)$/, 'server.hiredIssue', ['who', 'name', 'n']],
  [/^(.+?) hired (.+?) with a task across (.+)$/, 'server.hiredTaskAcross', ['who', 'name', 'repos']],
  [/^(.+?) hired (.+?) with a task$/, 'server.hiredTask', ['who', 'name']],
  [/^(.+?) hired (.+?) across (.+)$/, 'server.hiredAcross', ['who', 'name', 'repos']],
  [/^(.+?) hired (.+?)$/, 'server.hired', ['who', 'name']],
  [/^(.+?) opened a shell at a desk$/, 'server.openedShell', ['who']],
  [/^🏠 (.+?) sent (.+?) home: (.+)$/s, 'server.sentHomeWhy', ['who', 'name', 'why']],
  [/^(.+?) sent (.+?) home$/, 'server.sentHome', ['who', 'name']],
  [dashed(/^Kept (.+?)'s worktree and branch (\S+) <D> it has (.+)$/), 'server.keptWork', ['name', 'branch', 'work']],
  [/^Kept (.+?)'s worktree and branch (\S+)$/, 'server.kept', ['name', 'branch']],
  [dashed(/^Deleted (.+?)'s worktree and kept branch (\S+) <D> it has (.+)$/), 'server.deletedKeptWork', ['name', 'branch', 'work']],
  [/^Deleted (.+?)'s worktree and kept branch (\S+)$/, 'server.deletedKept', ['name', 'branch']],
  [dashed(/^Deleted (.+?)'s worktree and branch (\S+), and kept branch (\S+) <D> it has (.+)$/), 'server.deletedAlsoKept', ['name', 'branch', 'kept', 'work']],
  [/^Deleted (.+?)'s worktree and branch (\S+)$/, 'server.deleted', ['name', 'branch']],
  [dashed(/^Kept (.+?)'s worktrees and branch (\S+) in (.+?) <D> (.+)$/), 'server.keptAllWork', ['name', 'branch', 'where', 'work']],
  [/^Kept (.+?)'s worktrees and branch (\S+) in (.+)$/, 'server.keptAll', ['name', 'branch', 'where']],
  [/^Deleted (.+?)'s worktrees and branch (\S+) in (.+)$/, 'server.deletedAll', ['name', 'branch', 'where']],
  [/^Deleted (.+?)'s worktrees in (.+) and kept branch (\S+)$/, 'server.deletedAllKept', ['name', 'where', 'branch']],
  [/^(.+?)'s worktree is already there$/, 'server.worktreeThere', ['name']],
  [dashed(/^🌿 (.+?) rebuilt (.+?)'s worktree <D> (.+)$/), 'server.rebuiltNotes', ['who', 'name', 'notes']],
  [/^🌿 (.+?) rebuilt (.+?)'s worktree$/, 'server.rebuilt', ['who', 'name']],
  [dashed(/^🌿 (.+?) rebuilt the worktrees of ((?:(?!<D>).)+)$/), 'server.rebuiltMany', ['who', 'names']],
  [/^(.+?) handed issue #(\d+) to (.+)$/, 'server.handedIssue', ['who', 'n', 'name']],
  [/^(.+?) asked the (.+?) something$/, 'server.askedStation', ['who', 'name']],
  [/^(.+?)'s branch already has PR #(\d+)$/, 'server.branchHasPr', ['name', 'n']],
  [/^(.+?) opened PR #(\d+) for (.+)$/, 'server.openedPr', ['who', 'n', 'name']],
  [/^(.+?)'s pull requests are already open: (.+)$/, 'server.prsOpen', ['name', 'list']],
  [/^(.+?) opened (.+?)'s pull requests: (.+)$/, 'server.openedPrs', ['who', 'name', 'list']],
  [dashed(/^(.+?) still has uncommitted changes in its worktree <D> they are not in the PR$/), 'server.uncommitted', ['name']],
  [/^Couldn't assign issue #(\d+) on GitHub: (.+)$/s, 'server.assignFailed', ['n', 'why']],
  [/^(.+?) said PR #(\d+) is its own$/, 'server.saidOwnPr', ['who', 'n']],
  [/^(.+?) said PR #(\d+) is (.+?)'s$/, 'server.saidPr', ['who', 'n', 'name']],
  [/^(.+?) said it has no pull request$/, 'server.saidNoOwnPr', ['who']],
  [/^(.+?) said (.+?) has no pull request$/, 'server.saidNoPr', ['who', 'name']],

  // The queue: a board agent's first, since "📋 The Herald queued" would read as a person called "The Herald".
  [/^📋 The (.+?) queued issue #(\d+)$/, 'server.agentQueuedIssue', ['name', 'n']],
  [/^📋 The (.+?) queued “(.+)”$/s, 'server.agentQueuedTask', ['name', 'title']],
  [/^📋 (.+?) queued issue #(\d+)$/, 'server.queuedIssue', ['who', 'n']],
  [/^📋 (.+?) queued a task$/, 'server.queuedTask', ['who']],

  // GitHub.
  [/^(.+?) set PR #(\d+) to merge once its checks pass$/, 'server.autoMerge', ['who', 'n']],
  [/^🎉 (.+?) merged PR #(\d+)$/, 'server.merged', ['who', 'n']],
  [/^💬 (.+?) commented on PR #(\d+)$/, 'server.commentedPr', ['who', 'n']],
  [/^💬 (.+?) commented on issue #(\d+)$/, 'server.commentedIssue', ['who', 'n']],
  [/^(.+?) closed PR #(\d+) without merging$/, 'server.closedPr', ['who', 'n']],
  [/^(.+?) closed issue #(\d+) as not planned and took it off the queue$/, 'server.closedNotPlannedDropped', ['who', 'n']],
  [/^(.+?) closed issue #(\d+) as not planned$/, 'server.closedNotPlanned', ['who', 'n']],
  [/^(.+?) closed issue #(\d+) and took it off the queue$/, 'server.closedDropped', ['who', 'n']],
  [/^(.+?) closed issue #(\d+)$/, 'server.closedIssue', ['who', 'n']],
  [/^🏷️ (.+?) labeled PR #(\d+): (.+)$/, 'server.labeledPr', ['who', 'n', 'labels']],
  [/^🏷️ (.+?) labeled issue #(\d+): (.+)$/, 'server.labeledIssue', ['who', 'n', 'labels']],

  // Floors and the building.
  [/^🛗 (.+?) is adding a floor for (.+)…$/, 'server.addingFloor', ['who', 'repo']],
  [/^🛗 New floor: (.+), added by (.+?)$/, 'server.newFloor', ['floor', 'who']],
  [/^🛗 (.+?) stopped cloning (.+)$/, 'server.stoppedCloning', ['who', 'repo']],
  [/^🛗 (.+?) took (.+) off the building, so you rode the elevator to (.+)$/, 'server.floorGoneRode', ['who', 'floor', 'to']],
  [/^🛗 (.+?) took (.+), the last floor, off the building$/, 'server.lastFloorGone', ['who', 'floor']],
  [/^🛗 (.+?) took (.+) off the building$/, 'server.floorGone', ['who', 'floor']],
  [/^📁 (.+?) moved the workspace folder to (.+)$/, 'server.movedWorkspace', ['who', 'dir']],
  [/^📁 (.+?) put the workspace folder back to (.+)$/, 'server.resetWorkspace', ['who', 'dir']],

  // People and accounts.
  [/^(.+?) invited (.+?) to the office$/, 'server.invited', ['who', 'name']],
  [/^(.+?) removed (.+?)'s access$/, 'server.removedAccess', ['who', 'name']],
  [/^(.+?) revoked (.+?)'s account$/, 'server.revoked', ['who', 'name']],
  [/^(.+?) made (.+?) an admin$/, 'server.madeAdmin', ['who', 'name']],
  [/^(.+?) is no longer an admin$/, 'server.notAdmin', ['name']],
  [/^(.+?) switched the shared office password back on$/, 'server.sharedOn', ['who']],
  [dashed(/^🔑 (.+?) switched off the shared office password <D> everyone signs in with their own account now$/), 'server.sharedOff', ['who']],

  // The jukebox, the walls, the dog, the arcade, desks.
  [/^📻 (.+?) tuned the jukebox to (.+)$/, 'server.tunedRadio', ['who', 'track']],
  [/^🎵 (.+?) put on “(.+)”$/s, 'server.putOn', ['who', 'track']],
  [/^⏭️ (.+?) skipped to “(.+)”$/s, 'server.skipped', ['who', 'track']],
  [/^🔇 (.+?) turned the jukebox off$/, 'server.jukeboxOff', ['who']],
  [/^🖼️ (.+?) hung “(.+)”$/s, 'server.hungTitled', ['who', 'title']],
  [/^🖼️ (.+?) hung a picture$/, 'server.hung', ['who']],
  [/^(.+?) took down “(.+)”$/s, 'server.tookDownTitled', ['who', 'title']],
  [/^(.+?) took down a picture$/, 'server.tookDown', ['who']],
  [/^🐶 (.+?) named the dog (.+)$/, 'server.namedDog', ['who', 'name']],
  [/^🏆 (.+?) set a new arcade high score: (.+)$/, 'server.highScore', ['who', 'score']],
  [/^🪧 (.+?) hung a sign over (.+?): “(.+)”$/s, 'server.signHung', ['who', 'desk', 'text']],
  [/^🪧 (.+?) took the “(.+)” sign down from (.+)$/s, 'server.signDown', ['who', 'text', 'desk']],
  [/^🔨 (.+?) knocked out the back wall: (.+) are ready for workers$/, 'server.wallOut', ['who', 'desks']],
  [/^🧱 (.+?) walled the back office back up, and (.+) went with it$/, 'server.wallUp', ['who', 'desks']],

  // Settings.
  [/^(.+?) changed the building's map to (.+)$/, 'server.mapChanged', ['who', 'map']],
  [/^📣 (.+?) set up team notifications$/, 'server.webhookOn', ['who']],
  [/^(.+?) turned off team notifications$/, 'server.webhookOff', ['who']],
  [/^📣 Sent a test message$/, 'server.webhookTest', []],
  [/^⚙️ (.+?) set the worker limit to (\d+)$/, 'server.limitSet', ['who', 'n']],
  [/^⚙️ (.+?) took the worker limit off$/, 'server.limitOff', ['who']],
  [/^⚙️ (.+?) put the worker limit back to (\d+) \(--max-workers\)$/, 'server.limitBack', ['who', 'n']],
  [dashed(/^(.+?) is upgrading the office <D> it restarts when the new version is built$/), 'server.upgrading', ['who']],
  [/^🎃 (.+?) dressed the office up for Halloween$/, 'server.halloween', ['who']],
  [/^🎄 (.+?) dressed the office up for Christmas$/, 'server.christmas', ['who']],
  [/^(.+?) took the holiday decorations down$/, 'server.decorOff', ['who']],
  [/^📅 (.+?) set the decorations to follow the calendar \(it's Halloween 🎃 season\)$/, 'server.decorCalendarHalloween', ['who']],
  [/^📅 (.+?) set the decorations to follow the calendar \(it's Christmas 🎄 season\)$/, 'server.decorCalendarChristmas', ['who']],
  [/^📅 (.+?) set the decorations to follow the calendar$/, 'server.decorCalendar', ['who']],
  [/^🕰️ (.+?) put the sky on the real time of day$/, 'server.skyReal', ['who']],
  [/^⏩ (.+?) set the sky to a whole day every hour$/, 'server.skyFast', ['who']],
  [/^🏠 (.+?) set workers to go home by themselves once their pull request merges$/, 'server.leaveOnMerge', ['who']],
  [/^🪑 (.+?) set workers whose pull request merged to stay until they're sent home$/, 'server.stayOnMerge', ['who']],
  [/^📝 (.+?) rewrote the “(.+)” prompt$/, 'server.promptRewritten', ['who', 'label']],
  [/^📝 (.+?) put the default “(.+)” prompt back$/, 'server.promptReset', ['who', 'label']],
  [/^🤖 (.+?) set the office’s default worker$/, 'server.defaultWorker', ['who']],
  [/^🤖 (.+?) put the office’s default worker back to (.+)$/, 'server.defaultWorkerBack', ['who', 'cmd']],

  // Why something didn't happen.
  [/^Take the elevator to a floor first$/, 'server.takeElevator', []],
  [/^No such floor$/, 'server.noFloor', []],
  [/^No such worker$/, 'server.noWorker', []],
  [/^No such task$/, 'server.noTask', []],
  [/^Unknown agent provider$/, 'server.unknownProvider', []],
  [/^Empty prompt$/, 'server.emptyPrompt', []],
  [/^Empty task$/, 'server.emptyTask', []],
  [/^Only admins can take a floor off the building$/, 'server.adminsFloor', []],
  [/^Only admins can change the worker limit$/, 'server.adminsLimit', []],
  [/^Only admins can change the office’s prompts$/, 'server.adminsPrompts', []],
  [/^Only admins can pick the office’s default worker$/, 'server.adminsDefault', []],
  [/^Only admins can manage accounts$/, 'server.adminsAccounts', []],
  [/^The worker limit is a whole number from 1 to (\d+)$/, 'server.limitRange', ['n']],
  [dashed(/^The office is at its limit of (\d+) workers? on this machine <D> send one home before hiring another$/), 'server.atLimit', ['n']],
  [/^The office was started with --max-workers (\d+), so the limit can't go above \1$/, 'server.limitCeiling', ['n']],
  [/^Every desk and bean bag is taken: send someone home first$/, 'server.allTaken', []],
  [/^Sign in to Claude first \((.+?)\): your workers run on your own Claude plan$/, 'server.signInClaude', ['where']],
  [/^Sign in to GitHub first \((.+?)\): the office acts on GitHub as you$/, 'server.signInGitHub', ['where']],
  [/^On the shared office password, workers run on the office's own sign-ins$/, 'server.sharedSignIns', []],
  [dashed(/^That floor is still being cloned <D> it'll be ready in a moment$/), 'server.stillCloning', []],
  [/^There is no building to go up on yet$/, 'server.noBuilding', []],
  [/^An upgrade is already running$/, 'server.upgradeRunning', []],
  [/^Issue #(\d+) is already on the queue$/, 'server.issueQueued', ['n']],
  [/^The queue is full \((\d+) tasks\)$/, 'server.queueFull', ['n']],
  [dashed(/^(.+?) is on it <D> send the worker home to stop it$/), 'server.taskRunning', ['name']],
  [dashed(/^(.+?) works in the main checkout <D> only workers with their own worktree can open a PR$/), 'server.mainCheckout', ['name']],
  [/^(.+?)'s pull request is already being opened$/, 'server.prOpening', ['name']],
  [/^(.+?) isn't built yet: expand the back office first$/, 'server.notBuilt', ['desk']],
  [/^Tell the board agent what to do$/, 'server.boardAgentTask', []],
  [/^The (.+?) is waiting on an answer in its terminal$/, 'server.waitingAnswer', ['name']],
  [/^Worker is already running$/, 'server.alreadyRunning', []],
  [/^Worker is not running$/, 'server.notRunning', []],
  [/^The walls are full \((\d+) pictures\)\. Take one down first\.$/, 'server.wallsFull', ['n']],
  [/^Someone already took that picture down$/, 'server.pictureGone', []],
  [/^(.+?) already has a floor$/, 'server.hasFloor', ['repo']],
  [/^(.+?) is already being cloned$/, 'server.beingCloned', ['repo']],
  [/^The building is full \((\d+) floors\)$/, 'server.buildingFull', ['n']],
  [/^The meeting room is busy with “(.+)”: stop that meeting first$/s, 'server.meetingBusy', ['title']],
  [/^Say what the meeting is about$/, 'server.meetingAbout', []],
  [/^No meeting is on$/, 'server.noMeeting', []],
  [/^The meeting is still on: stop it first$/, 'server.meetingOn', []],
  [/^Someone is still sitting at the meeting table$/, 'server.meetingSeated', []],
  [/^Nobody is in the meeting room$/, 'server.meetingEmpty', []],
  [/^You can't revoke your own account$/, 'server.ownAccount', []],
  [/^You can't change your own role$/, 'server.ownRole', []],
  [/^Sign in with an admin account of your own first, or nobody could get back in$/, 'server.adminFirst', []],
  [dashed(/^(.+?) is on the arcade <D> press E there to watch$/), 'server.onArcade', ['name']],
  [/^🕹️ That's a lot of new games in a row, so this one won't go on the high-score table$/, 'server.arcadeMany', []],
  [/^🕹️ The office couldn't follow this game, so its score won't go on the high-score table$/, 'server.arcadeLost', []],

  // Signing in, invites, claim links, pictures.
  [/^Wrong name or password$/, 'server.wrongNamePassword', []],
  [/^Wrong password$/, 'server.wrongPassword', []],
  [/^Wrong password\. With an account of your own, type your name too\.$/, 'server.wrongPasswordName', []],
  [/^Sign in with your name and your own password$/, 'server.ownPassword', []],
  [/^Too many attempts\. Try again in a few minutes\.$/, 'server.tooMany', []],
  [/^Bad request$/, 'server.badRequest', []],
  [/^Not logged in$/, 'server.notLoggedIn', []],
  [/^Internal error$/, 'server.internal', []],
  [/^This invite link has expired or was already used\. Ask whoever sent it for a new one\.$/, 'server.inviteExpired', []],
  [/^This invite link has expired or was already used\. Ask for a new one\.$/, 'server.inviteExpiredShort', []],
  [/^This invite link was just used\. Ask for a new one\.$/, 'server.inviteUsed', []],
  [/^This office has already been claimed\. Sign in with the password you saved\.$/, 'server.claimed', []],
  [/^That claim link is not valid\.$/, 'server.claimInvalid', []],
  [/^That sign-in link was already used\. Sign in with the office password\.$/, 'server.linkUsed', []],
  [/^Pick a name$/, 'server.pickName', []],
  [/^Pick a password of at least (\d+) characters$/, 'server.passwordShort', ['n']],
  [/^That password is too long$/, 'server.passwordLong', []],
  [/^That name has no letters in it$/, 'server.nameNoLetters', []],
  [/^There's already an account called (.+)$/, 'server.nameTaken', ['name']],
  [/^(.+?) already has an open invite$/, 'server.nameInvited', ['name']],
  [dashed(/^Too many open invites <D> cancel some first$/), 'server.tooManyInvites', []],
  [/^"(.+)" isn't a GitHub username$/, 'server.notGitHubUser', ['user']],
  [/^There's no GitHub user called (.+)$/, 'server.noGitHubUser', ['user']],
  [dashed(/^(.+?) has no SSH keys on GitHub <D> they can add one at github\.com\/settings\/keys$/), 'server.noSshKeys', ['user']],
  [/^Invites work on offices set up with deploy\/provision\.sh or deploy\/aws\.sh$/, 'server.invitesUnavailable', []],
  [/^Couldn't reach GitHub: (.+)$/s, 'server.gitHubUnreachable', ['why']],
  [/^That picture is too big for the whiteboard$/, 'server.whiteboardTooBig', []],
  [/^The whiteboard has too many pictures on it\. Delete some first\.$/, 'server.whiteboardFull', []],
  [/^That image is over 15 MB\. Try a smaller one\.$/, 'server.imageTooBig', []],
  [/^That link is a web page, not an image\. Right-click the picture and choose “Copy image address”\.$/, 'server.webPage', []],

  // What a teammate is doing (PeerInfo.doing): each browser sends it in English, see openModal's `doing`.
  [/^📋 at the issues board$/, 'server.doing.issuesBoard', []],
  [/^🔀 at the PR board$/, 'server.doing.prBoard', []],
  [/^🛗 at the elevator$/, 'server.doing.elevator', []],
  [dashed(/^gh isn't signed in to GitHub on the office's machine <D> run `gh auth login` there$/), 'server.ghSignedOut', []],
  [/^🔎 searching the office$/, 'server.doing.searching', []],
  [/^🪧 labeling (.+)$/, 'server.doing.labeling', ['desk']],
  [/^🔨 in the back office$/, 'server.doing.backOffice', []],
  [/^🤝 at the meeting room$/, 'server.doing.meetingRoom', []],
  [/^⚙️ in settings$/, 'server.doing.settings', []],
  [/^🪞 picking a new look$/, 'server.doing.look', []],
  [/^📝 reading the office’s prompts$/, 'server.doing.prompts', []],
  [/^💻 in (.+)'s terminal$/, 'server.doing.terminal', ['name']],
  [/^🌐 at the services board$/, 'server.doing.services', []],
  [/^🔀 looking over pull requests$/, 'server.doing.pulls', []],
  [/^📚 at the bookshelf$/, 'server.doing.bookshelf', []],
  [/^📚 reading (.+)$/s, 'server.doing.readingBook', ['title']],
  [/^📋 reading issue #(\d+)$/, 'server.doing.readingIssue', ['n']],
  [/^🔀 reading PR #(\d+)$/, 'server.doing.readingPr', ['n']],
  [/^🎵 at the jukebox$/, 'server.doing.jukebox', []],
  [/^🌿 looking over (.+)'s changes$/, 'server.doing.changes', ['name']],
  [/^💣 playing Minesweeper$/, 'server.doing.minesweeper', []],
  [/^📥 at the queue$/, 'server.doing.queue', []],
  [/^🖍️ at the whiteboard$/, 'server.doing.whiteboard', []],
  [/^🖥️ watching (.+)'s screen$/, 'server.doing.screen', ['name']],
  [/^🖼️ hanging a picture$/, 'server.doing.hanging', []],
];

/** `text` from the server, in the page's language when a rule knows it. */
export function serverText(text: string): string {
  if (lang() === 'en') return text;
  for (const [pattern, key, holes] of RULES) {
    const m = pattern.exec(text);
    if (m) return t(key, Object.fromEntries(holes.map((name, i) => [name, m[i + 1] ?? ''])));
  }
  return text;
}

/** The rules, for the tests: each key exists and has the holes its rule fills. */
export const SERVER_RULES = RULES;
