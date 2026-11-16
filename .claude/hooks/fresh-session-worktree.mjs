// SessionStart hook: brings a newly started session's worktree up to a fresh
// origin/main. Claude Code branches session worktrees from its cached
// origin/HEAD and only re-fetches when the repository has gone a day without
// one, so a new session can start up to a day behind. This fetches every time
// and fast-forwards the worktree when that is lossless: a linked worktree, on
// its own branch, with no local changes and no commits of its own. Anything
// else is reported and left alone. The hook never blocks a session — it always
// exits 0, and what it prints becomes session context.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REMOTE = 'origin';
const BASE_BRANCH = 'main';
const BASE_REF = `${REMOTE}/${BASE_BRANCH}`;
const FETCH_TIMEOUT_MS = 20_000;

function git(cwd, args, options = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // A hook has no terminal: fail rather than wait on a password or host prompt.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -oBatchMode=yes' },
    ...options,
  }).trim();
}

function tryGit(cwd, args, options) {
  try {
    return git(cwd, args, options);
  } catch {
    return null;
  }
}

function short(sha) {
  return sha.slice(0, 9);
}

// Returns the one-line report for the session, or null when there is nothing to say.
export function freshenWorktree({ cwd, source }) {
  if (source !== 'startup' || !cwd) return null;

  const top = tryGit(cwd, ['rev-parse', '--show-toplevel']);
  if (!top) return null;

  // Only a linked worktree: the main checkout may be shared and is never moved.
  const gitDir = tryGit(top, ['rev-parse', '--absolute-git-dir']);
  const commonDir = tryGit(top, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!gitDir || !commonDir || path.resolve(gitDir) === path.resolve(commonDir)) return null;

  const branch = tryGit(top, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (!branch || branch === BASE_BRANCH) return null;

  try {
    git(top, ['fetch', REMOTE, BASE_BRANCH, '--prune', '--quiet'], { timeout: FETCH_TIMEOUT_MS });
  } catch {
    return `Fresh-worktree hook: could not fetch ${BASE_REF}; this worktree may be behind it. Run \`git fetch ${REMOTE} ${BASE_BRANCH}\` and check before building on it.`;
  }

  const head = git(top, ['rev-parse', 'HEAD']);
  const base = git(top, ['rev-parse', BASE_REF]);
  if (head === base) return `Fresh-worktree hook: ${branch} is at current ${BASE_REF} (${short(base)}).`;

  const [ahead, behind] = git(top, ['rev-list', '--left-right', '--count', `HEAD...${BASE_REF}`]).split(/\s+/).map(Number);
  if (behind === 0) return null;

  if (ahead > 0) {
    return `Fresh-worktree hook: ${branch} has ${ahead} commit(s) of its own and is ${behind} behind ${BASE_REF}; left as is. Rebase onto ${BASE_REF} if it should be current.`;
  }
  if (git(top, ['status', '--porcelain']) !== '') {
    return `Fresh-worktree hook: ${branch} is ${behind} commit(s) behind ${BASE_REF} but has local changes; left as is.`;
  }

  git(top, ['merge', '--ff-only', '--quiet', BASE_REF]);
  return `Fresh-worktree hook: fast-forwarded ${branch} from ${short(head)} to current ${BASE_REF} (${short(base)}, ${behind} new commit(s)).`;
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
}

if (invokedDirectly()) {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  try {
    const report = freshenWorktree(JSON.parse(input || '{}'));
    if (report) console.log(report);
  } catch (error) {
    console.log(`Fresh-worktree hook: skipped (${error instanceof Error ? error.message.split('\n')[0] : String(error)}).`);
  }
}
