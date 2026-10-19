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

## Optional paid model choices

Create a Runpod inference key restricted to `qwen3-32b-awq` (no management access).
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

The [published Runpod rate](https://docs.runpod.io/public-endpoints/models/qwen3-32b)
was $10/M tokens on October19,2026; verify current pricing before use. Identical
requests are cached. Each uncached request reserves prompt UTF-8 bytes +1,024
formatting units +96 output units before inference, deliberately conservative.

The persistent allowance is **1,000,000 reserved units**, about **$10 total** at
that price, not monthly or account-wide. Maximum100 uncached requests/minute;
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
