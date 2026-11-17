# Proposed first live provider profile

22 October 2026, Asia/Jakarta. **Recommendation only; disabled and not an authorization to spend.** The owner asked for a suggestion. No credential was requested in chat, read from the website, saved here or sent to a provider. No account access or successful live request has been verified.

Use a dedicated OpenAI API project through the Responses API. Seven fictional profiles can share model infrastructure while retaining separate role prompts, records, workspace permissions, reviews and ownership. My recommendation is GPT-6 Luna for bounded role drafts and routine structural review, with GPT-6.1 Sol for Adrian's package synthesis and the final package reviewer. This is an engineering starting point, not an evaluated quality claim for Enztronic data. Evaluate supplied-brief accuracy, source citations, unknowns, role separation and refusal of external effects before expanding it.

| Setting | Proposed initial limit |
|---|---|
| Activation | Disabled until owner approval, dedicated secret, adapter implementation and local/live verification |
| Draft model | `gpt-6-luna`, low reasoning, Standard processing |
| Package/final-review model | `gpt-6.1-sol`, low reasoning, Standard processing |
| Whole Office monthly metered-model cap | USD 10, including reservations and unresolved outcomes |
| Entire proposal family cap | USD 1 across parent, children, reviews, retries and revisions |
| Single API request cap | USD 0.15, reserved before dispatch |
| Concurrency | One proposal, one model request at a time |
| Input/output | At most 12,000 input tokens and 6,000 output tokens per request, with reasoning included in the output bound |
| Time | 90 seconds per request; 10 minutes per proposal attempt |
| Initial attempt | At most 16 model calls; owner-requested revisions share the same USD 1 family cap |
| Retries | No blind retry of unknown outcomes; retain reservation until reconciled |
| Tools/data | Only owner-supplied permitted internal brief and generated scoped artifacts; no paid tools, web search, file search, shell, financial actions or sends |

Official standard short-context text prices checked today: Luna input USD 0.10 and output USD 0.50 per million tokens; Sol input USD 2 and output USD 10. Cache-write prices are USD 0.125 and USD 2.50 per million input tokens. Do not assume cache savings. As a planning example, twelve Luna calls plus four Sol calls at the full proposed 12k input/6k output bounds cost about USD 0.42 using those cache-write input rates. This is calculated, not observed usage; regional processing, other paid capabilities, price changes and taxes can change billing. Stop rather than silently increase a cap or switch to a more expensive model.

Sources: [Luna model and prices](https://developers.openai.com/api/docs/models/gpt-6-luna), [Sol model and prices](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [official pricing](https://developers.openai.com/api/docs/pricing). Recheck model availability, an appropriate pinned snapshot where available, prices, token counting and account-specific limits during activation. This recommendation is not a broad comparison or claim that every provider was benchmarked.

## Implementation and activation boundary

The current worker remains deterministic-demo only and refuses live execution. Existing exact reservations and tool-operation reconciliation are useful foundations, but this document is not an executable configuration and does not implement the proposed monthly/family/request accounting or a live Responses adapter. Those limits must be enforced transactionally by the reviewed adapter/runtime before any paid call; provider dashboard alerts alone do not establish these hard caps. Unknown billed outcomes must continue to reserve their maximum possible cost. A model's prose cannot release a reservation or grant a permission.

If this profile is selected, prepare the adapter with mocked transport tests first, then configure the Office-only project credential in secure host configuration. Verify one bounded real internal proposal and its real independent review, usage and failure handling before enabling more work. Selecting a profile does not authorize production migration, service restart, deployment or external client effects. Production activation retains its separate approved window.
