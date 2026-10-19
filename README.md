# Local island simulator

Eight castaways search for food, avoid storms, talk, and vote someone off the island. The winner gets +1; everyone else gets 0. Movement is scripted. Optional pretrained Qwen3-32B-AWQ supplies dialogue, short public intention summaries and votes. This is a demonstration, not evidence of a trained survival policy or learned cooperation.

The public [homepage example](https://clarkwhitehead.com) is fully scripted and free. **This repository includes no account credentials and never connects to the author's Runpod account.** To use paid conversations, supply your own key locally.

## Run immediately

Requires Node.js 22.6 or newer. Built browser files are included; no package installation is needed to run.

```sh
git clone https://github.com/Nova-Rift/island-simulator.git
cd island-simulator
node server.mjs
```

Open **http://127.0.0.1:4174**. Choose **Continue without dialogue** for a free local simulation. No inference happens on page load. Ctrl+C stops the server.

## Optional paid Runpod conversations

Create your own restricted inference key for the managed `qwen3-32b-awq` endpoint in Runpod Credentials. Give it inference permissions only, not account management. Save it outside Git in a file owned by you with mode0600 (Linux/macOS), then start:

```sh
RUNPOD_KEY_FILE=/absolute/path/to/private-key node server.mjs
```

This variable contains the **path**, never the key itself. Avoid pasting credentials into commands, chat, source files or browser code. The server reads the key locally; browsers receive only generated text. Key loading rejects symlinks and files readable by other OS users.

Click **Play with conversations** to start paid inference. Movement starts immediately, and each council generates dialogue on the map, updates both participants' cards, then records a mandatory vote per remaining castaway. Invalid model votes use labeled game-rule votes. Reset/disable dialogue cancels pending browser requests; requests already processed by Runpod can still be billed.

The server binds exclusively to `127.0.0.1:4174`. Exact Host and Origin checks reject cross-site requests and DNS rebinding; no CORS or public tunnel is enabled. Do not expose it through a reverse proxy or change the binding. Other trusted processes on your OS account can still access local files/services.

## Cost controls

Runpod's [published model price](https://docs.runpod.io/public-endpoints/models/qwen3-32b) was $10 per million tokens on October19,2026; check current pricing before use. There is no dedicated GPU worker here.

- Identical requests reuse a local cached response.
- Each new request reserves UTF-8 prompt bytes plus 1,024 template units and 96 output units before contacting Runpod. This deliberately overestimates typical tokens.
- The persistent allowance is **1,000,000 reserved units**, approximately **$10 total at that price**, not a monthly allowance or an account-wide billing cap.
- Maximum 100 new requests per minute. Failed requests retain their reservation.
- `.local/state/` contains the private cache and usage ledger and is ignored by Git. Keep it across restarts; deleting it resets the guard. Disk/storage errors fail closed.
- No automatic retries or background generation. Only one server should own the state directory.

## Read or change the code

| File | Purpose |
|---|---|
| `src/LiveSurvival.tsx` | Controls, canvas, live cards and council lifecycle |
| `src/islandLanguage.ts` | Prompts, dialogue, public summaries and validated votes |
| `src/simulation/island-game.mjs` | Environment rules and winner-only reward |
| `src/simulation/island-renderer.mjs` | Human castaway drawing |
| `src/IslandSpeech.tsx`, `src/speechLayout.ts` | On-map, nonoverlapping speech |
| `server.mjs` | Loopback-only HTTP server and private key loading |
| `server/dialogue.mjs` | Validation, cache and reservation limits |
| `server/runpod-client.mjs` | Fixed provider/model transport |
| `server/file-store.mjs` | Private persistent cache and atomic ledger |

Environment files are pinned copies of [Nova-Rift/survival-env](https://github.com/Nova-Rift/survival-env), with exact revisions and hashes in `src/simulation/provenance.json`. Custom agent API documentation is in that repository. Make environment changes upstream, then update these copies and provenance together.

To rebuild the included browser files, install the pinned development dependencies and run `npm run build`. This is optional for running the committed version. `npm test` runs contract/security tests without inference or account access. The optional `scripts/check-island-browser.mjs` uses an existing Chrome, an isolated profile and DOM checks only; it performs paid inference if pointed at a keyed local instance. No screenshots are taken. Browser verification is optional and requires no installation for normal use.

## Data and credentials

Only allowlisted browser assets are served. Source files, `.local/`, key files and environment variables are never HTTP assets. The server sends game prompts to Runpod only after you choose paid conversations. Do not put sensitive personal data into game dialogue. No telemetry or other application backend is included.
