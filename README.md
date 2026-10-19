## Current default: blank agent sandbox

Open http://127.0.0.1:4174/ to see an empty environment with ten stationary
agents. No behavior, dialogue, voting, or model calls run in this new environment.
Older simulations remain in the Environment menu; the social archive is scripted.

Paid inference is disabled by default on server startup, including for stale tabs.
Saved keys and the existing reservation ledger are preserved. The older paid setup
instructions below are historical; loading a key alone no longer enables inference.
Explicit `ISLAND_ENABLE_PAID=1` is required to enable the server's old paid endpoints.
The new sandbox has no paid controls or API calls regardless of that setting.

# Local social simulator

Eight agents have conversations and eventually vote someone out. No food, weather,
health or movement. Each agent can invite, request to join, accept or decline,
speak or sit out, leave, and propose excluding someone. After four social rounds,
everyone votes. Repeat until one winner gets +1; everyone else gets 0.

**Free scripted mode is the default.** The public [homepage](https://clarkwhitehead.com)
also runs a scripted example. This repository contains no account credentials and
does not connect to the author's Runpod account. Optional paid agents use your own
local key. The earlier island game remains runnable from the top button.

## Run

Requires Node22.6+. Built browser files are included; no npm installation needed.

```sh
git clone https://github.com/Nova-Rift/island-simulator.git
cd island-simulator
node server.mjs
```

Open **http://127.0.0.1:4174**. Play, Next turn, Pause, Reset and Speed control the
example. Speech stays beside the agent in its conversation. Cards show each
agent's short current intention. These are stated intentions, not hidden reasoning.

## Social rules and privacy

- Invited agents choose whether to join. Anyone can decline, remain silent or leave.
- Uninvited agents can request entry. Every current member must admit the requester;
  any member can decline. Waiting agents hear nothing inside.
- A group can exclude a member with a strict majority of the other members and at
  least two supporters. The target does not vote on their own removal. Exclusion
  blocks reentry to that conversation. Membership changes cancel pending proposals
  and join requests so earlier consent cannot silently apply to a different group.
- Only members present at the time hear a message. Late joiners cannot read earlier
  messages; leavers/excluded agents keep what they already heard but get no future
  messages. Group membership is visible, conversation contents are private.
- The viewer sees all groups. Models receive only `observe(agent)`, never spectator
  frames or other agents' intentions. Agents can voluntarily repeat information
  they previously heard; the engine prevents automatic transcript sharing.
- Four rounds give each remaining agent one choice per round, then a mandatory
  non-self vote. Most votes eliminates one; seeded tie-breaking is reproducible.
  Groups reset after a vote, memories persist, and eliminated agents cannot act.

This is a deliberately simplified turn-based social game, not a simulation of
all human behavior, a trained survival policy or evidence of learned cooperation.

## Full context across rounds

Every decision and intention update receives the agent's **entire personal game
history**: all messages/events it heard, its own action/vote history, and previous
intention updates. There is no last-N window and no replacement of old events
with a summary. Privacy still applies: other conversations and other agents' own
choices/intentions are not supplied. Histories live in browser memory until Reset
or page reload; this is not cross-session persistence.

The model has a finite context capacity. Requests explicitly disable prompt
truncation; provider rejection or the 256KiB transport ceiling **pauses the game**
instead of discarding memories or substituting a rule action. If an intention
update hits the limit after speech, that speech stays recorded and play pauses.
A larger-context model would be needed to exceed its capacity. Keeping everything
available does not guarantee perfect recall or attention. Longer input increases
paid usage; the existing private cache and reservation ledger are preserved.
No full paid game or unlimited-context guarantee is claimed.

## Optional paid model choices

Create a Runpod inference key restricted to `granite-4-0-h-small` (no management access).
Save it outside Git in a file owned by you with mode0600, then start:

```sh
RUNPOD_KEY_FILE=/absolute/path/to/private-key node server.mjs
```

The variable contains a path, not a key. Never paste a key into source, commands,
chat or browser code. Select **Use my local Runpod (paid)**, then Play or Next turn.
The model chooses from legal social actions, receives only its own observations,
updates listeners' intentions after speech and casts votes. Invalid/unavailable
actions sit out; invalid mandatory votes use an explicitly labeled rule fallback.
Changing mode resets the game. Reset aborts pending requests, but already processed
Runpod requests can still be billed. No inference happens on page load.

The server binds only to `127.0.0.1:4174`, checks Host/Origin and serves an explicit
asset allowlist. No CORS or public tunnel. Do not expose it through a proxy or
change the binding. Trusted local OS processes can access localhost/private files.
Ctrl+C stops it.

## Cost controls

The [Runpod pricing page](https://www.runpod.io/pricing) lists Granite at
**$1/M tokens**, checked October19,2026. This corrects the earlier $10/M
assumption from the model documentation. Verify pricing before use. Identical
requests are cached. Each uncached request reserves prompt UTF-8 bytes +1,024
formatting units +96 output units before inference, deliberately conservative.

The persistent allowance is **50,000,000 reserved units**, conservatively corresponding to the **$50 total task ceiling** at
that price, not monthly or account-wide. This is a conservative reservation limit,
not measured billing. The earlier 1,000,000-unit limit was raised on October 19
when Clark requested unblocking local paid play; corrected to50,000,000 on
October19 at his request after checking Granite pricing. Previous reservations
still count. The legacy ledger field named `tokens` holds reservation units,
not actual tokens. `/api/island/status` reports this distinction and no actual
dollar total; use Runpod billing for charges. Maximum600 uncached requests/minute;
failures retain reservations and storage failures block inference. Private cache
and ledger live in ignored `.local/state/`. Preserve them across restarts: deleting
this directory resets the spending guard. No background generation or retries.

## Code

| File | Purpose |
|---|---|
| `src/social.mjs` | Canonical social environment; observations, legal actions and votes |
| `src/socialPolicy.ts` | Scripted example, model prompts and action validation |
| `src/SocialDemo.tsx` | Groups, speech, controls, intentions and optional model loop |
| `server.mjs` | Loopback-only server and private key loading |
| `server/dialogue.mjs` | Validated inference, persistent reservation budget and cache |
| `server/file-store.mjs` | Atomic local storage |
| `src/LiveSurvival.tsx` | Earlier island game, retained separately |

Environment source and [API docs](https://github.com/Nova-Rift/survival-env/blob/browser-environment/browser/SOCIAL.md)
live in `survival-env`; exact source hash is in `src/social-provenance.json`.
Make rule changes upstream, then sync this pinned copy. Original survival rules
and historical checkpoints are unchanged.

`npm test` runs tests without inference. To rebuild, install the pinned dev
dependencies and run `npm run build`; installation is optional for running the
included build. `scripts/check-social-browser.mjs` uses an existing Chrome and
isolated DOM checks with zero inference; `node --experimental-strip-types
scripts/check-social-model.mjs` is an explicit four-request PAID local smoke test.
Neither script takes screenshots. The old island browser checker is for the
archived game. No telemetry or author's credentials are included.

### Conversation history and assessments

The history panel includes conversations from earlier votes, including closed
and disbanded groups. Filter by conversation or by who heard an event. It is a
viewer feature: agents still receive only their personal observations. Reset or
reload clears the current game's history.

After each spoken exchange, participating agents receive updated situation cards.
In local paid mode, these include the model's subjective winning estimate (not
calibrated odds). The card records its conversation and turn and stays visible
until that agent's next exchange. Invalid responses show unavailable rather than
inventing a probability. Free scripted mode has no model probability. Local mode
starts free; enable **Use my local Runpod (paid)** to request live AI choices.

Optional DOM-only verification with mocked model responses (no inference charge):
`node --experimental-strip-types scripts/check-social-history.mjs http://127.0.0.1:4174/`.

Active conversations display a scrolling chatbox beside their participants. Every
message stays in the chat, with speaker and turn labels. New activity follows the
bottom unless you scroll up to read; use “New activity” to return to the latest
messages. Closed conversations remain available in the history panel below.

Open **Starting prompt · editable** above the controls to inspect or change the
live decision system prompt. `{name}` is replaced with each agent's name. Pause
before editing; edits affect subsequent decisions. Reset preserves the edited
prompt while clearing the game; reload restores the default. “Restore default
prompt” restores the shared built-in instructions. Personal observations are still
attached separately; assessment prompts and game rules are unchanged. Scripted
mode does not use the prompt.

### Personal social knowledge

Agents retain structured records of requests and responses: who asked, which
conversation, who supported or denied entry, acceptance and cancellations. Only
involved people receive those notifications. Other groups' members and activity
are absent from model observations. Agents can discover a conversation through
an invitation or someone mentioning “conversation N” while talking. Such reports
remain attributed, unverified speech; the default prompt allows asking questions,
refusing disclosure, telling the truth or lying. The viewer can still see all groups.

### On-demand and end-of-game AI recaps

**Summarize game so far (paid)** is available after the first action, including
while play continues. It captures an immutable snapshot, labels its turn/vote
count and describes only observed events, without inventing a winner. Request
another summary later to update all player cards. Summaries are viewer-only and
never enter agents’ observations. A separate reviewer connection keeps gameplay
and summaries independent. If the game ends during a requested recap, its final
recap is queued next.

When a paid game finishes, an outside model reviewer receives the complete event
transcript, council ballots (including recorded reasons), final state and winner.
It writes one brief recap per player, distinguishing evidence from interpretation
and treating dialogue as potentially deceptive. Each recap uses eight bounded per-player requests through the same local
budget/cache, not additional player knowledge. An in-progress recap also uses one
forecast request to rank all remaining players from next elimination to predicted
winner. Cards display best-first standings (#1 winner): eliminated players’ places
come from recorded councils and cannot be changed by the model. Survivors’ places
are explicitly speculative. Completed games use only confirmed results and need
no forecast request. Invalid/duplicate/missing forecast IDs are rejected; retry
regenerates only missing results, with no invented ranking fallback.
Scripted games offer an explicit **Generate AI recap (paid)** button instead of
charging automatically. Failed recaps can be retried without regenerating completed
cards. Reset discards pending results. Context overflow never trims the record.

Model errors now pause the game rather than substituting a rule-based action.
Messages distinguish the conservative reservation limit, rate limiting, malformed
or illegal decisions, incomplete responses and provider failures. The reservation
ledger is NOT billed-token usage: it charges prompt UTF-8 bytes plus overhead and
maximum output, without refunding failed requests. It can stop much earlier than
the nominal dollar estimate implies; use Runpod billing for actual charges.

Live decisions use a tiny strict JSON schema containing only a legal integer
choice. The simulator maps it to that exact action. Short speech or vote reasons
are generated separately using provider-enforced JSON-object mode, without a
large constrained text schema. Assessments, recaps and rankings use this mode too;
their fields are still validated locally. Numeric action choices retain their
strict legal-choice schema. It cannot supply a different
target or group. This supersedes the one-correction retry approach. The complete
personal observation remains intact; schemas are included in request limits,
reservations and cache keys. No unconstrained fallback or automatic retry. Provider
failures still pause. Constrained output does not guarantee sensible strategy or
an accurate stated intention.

Inviting someone does not immediately start a conversation. Both people remain
on their own until acceptance; outstanding invitations appear separately. Chat
panels require at least two participants. If only one remains, they return to the
on-their-own area and the transcript stays in history.

Provider integration uses [vLLM structured output response formats](https://docs.vllm.ai/en/stable/examples/features/structured_outputs/).

### Waiting for the model

Turn speed only shortens the delay between turns, not inference latency. The UI
shows elapsed waiting time. **Stop waiting** aborts the current model request and
keeps the current game state (a speech already delivered is not rolled back).
The shared Runpod endpoint can be slow: a live initial-action check took ~64s.
Schema string-length constraints were removed to simplify decoding; output tokens
remain capped and displayed text is still bounded. No fast-response guarantee.


### Independent conversations

Live games use one independent asynchronous lane per conversation or solo agent.
Inside a group, each message and its personal assessments finish before the next
speaker decides. Other groups and solo invitations do not wait. Incoming personal
information invalidates only the affected pending decision; it is recomputed with
its complete updated context. No stale action is forced through. Joining merges
lanes; leaving splits them. A solo inviter can accept a different invitation,
withdrawing their own outstanding invitations.

Live agents can act throughout a shared two-minute discussion before every vote.
There are no personal speaking/setup quotas. Waiting schedules reconsideration
in five seconds; new private notifications wake the agent earlier. Everyone sees
`voteClock.secondsRemaining` in their observation; the UI displays the same
countdown. Pause freezes active time; speed controls do not shorten the discussion.
At zero the runner stops new decisions, finishes pending replies/assessments, then
opens voting. “Call vote now” can end discussion early with the same drain rule.
After elimination a fresh two-minute window starts. Default scripted walkthroughs
retain their four authored rounds. The bounded local spending guard still applies.

The local provider is IBM Granite 4.0 H Small via Runpod's native runsync API.
Observed bounded test: three independent choices and two spoken messages finished
in18.7s total; assessments then took1.1–1.5s. Individual numeric-choice requests
varied from0.4s in isolation to8.7–10.4s under the concurrent test. This is not a
latency guarantee or full-game benchmark. Earlier rich constrained responses took
~120s in that test. No dedicated GPU, persistent worker or public paid endpoint
was created. Public code needs your own endpoint-restricted key.


A subsequent integrated live scheduler check completed12 accepted social actions
in5.9s, including a join, while unrelated agents proceeded. It started22 requests;
16 completed before the bound and none was a cache hit. Outstanding requests were
cancelled at the test bound. No full-game latency claim. End-game player recaps
also run concurrently. The local request-rate allowance is600/minute to accommodate
parallel lanes; the persistent reservation guard remains; see Cost controls for the corrected limit.

Speech and decision prompts explicitly name the current accepted conversation
participants and listener count, derived only from the agent’s own membership.
One-to-one exchanges address the other person directly. Pending invitees and
former members are not listeners; the audience is rebuilt for each decision.

### Diagnosing a paused request

`/api/island/status` confirms local configuration, not live provider health. Its
`lastFailure` records only a timestamp, a safe error category and an HTTP status
when available. It never stores prompts, credentials or raw provider error bodies.
The UI distinguishes provider timeouts, authentication/billing restrictions,
rate limits, failed jobs and local connectivity. HTTP400 is a request rejection,
not automatically a context overflow. A failure pauses with the game preserved;
Play retries through the normal reservation guard. No automatic paid retries or
scripted replacement decisions are introduced.

### Switch between Runpod and OpenAI

The local social simulator has a **Model provider** selector: Runpod (Granite) or
OpenAI (`gpt-6-astra`). Enable **Use live agents (paid)** to run agent decisions;
recap buttons also use the selected provider. Pause and let pending requests
finish before switching. Switching retains the game, discussion clock and each
agent's private history. Independent conversations still run in parallel.
There is no automatic provider fallback.

OpenAI requires a separate API key and API billing, not a ChatGPT subscription.
From this repository, run `npm run setup:openai` and paste the key into the hidden
terminal prompt, then restart the local server. The key is saved with private
permissions in ignored `.local/openai-api-key`. Alternatively set
`OPENAI_API_KEY_FILE` to an owned, regular mode-0600 key file, or supply
`OPENAI_API_KEY` through your process environment. Never commit or paste keys into
source code. The server binds only to `127.0.0.1`; keys never enter the browser.

Astra requests use Responses with `store:false`, low reasoning effort, and a
2,048-token output ceiling including reasoning. Every request includes the full
appropriate history; no context is silently trimmed. Incomplete or invalid outputs
pause the game, without a scripted substitute or automatic paid retry. Access to
the exact model depends on your OpenAI API account.

Both providers share the existing $50 conservative reservation ceiling. Existing
reservations are preserved. A reservation unit represents $0.000001 of allowance,
not a billed token. Runpod reserves prompt bytes + overhead + maximum output at
$1/M; Astra reserves input bytes + overhead at $10/M and maximum output at $50/M.
The full output allowance is reserved even when unused, and failed requests are
not refunded, so this can stop well before actual billing reaches $50. It is not
an account-wide billing cap. No cached-input discount is assumed. The 262KB request
limit stays below Astra's long-context pricing threshold.
See [Astra model documentation](https://developers.openai.com/api/docs/models/gpt-6-astra)
for current prices and access. This change adds no paid inference to the public
website. Clones contain no account credentials.

The game now ends with a final-three jury vote: all five eliminated agents vote
for the winner, using their retained private histories. Finalists do not vote.
A seeded tie-break resolves tied winner ballots; only the winner earns +1.
The two other finalists share runner-up status. Start a new game after reloading
to use the updated rules.
