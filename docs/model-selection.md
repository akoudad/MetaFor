# Model selection

The Mac app has one shared model choice beside the composer in Chat and Help.
It applies to the next question and survives relaunch. A running answer keeps its
original model and reasoning setting through every request.

| Choice | Actual model | Reasoning | Intended use |
| --- | --- | --- | --- |
| Fast | Muse Spark 1.3 (`muse-spark-1.3`) | Minimal | Quick questions and everyday screen help |
| Balanced — default | Muse Spark 1.3 (`muse-spark-1.3`) | Medium | Everyday work with moderate reasoning |
| Deep | Muse Wonder 1.0 (`muse-wonder-1.0`) | High | Complex problems and deeper analysis |

Fast and Balanced use the same model with different reasoning effort. These are
usage recommendations, not response-time guarantees. Deep can take longer.

Fast uses Meta's lowest supported effort, `minimal`; `none` is not supported.
In Chat, Spark 1.3 / Minimal writes the answer and chooses its topic structure in
one request. Its graph output still passes the same checks for destinations,
split topics, synthesis links, annotation ownership, and complete answers.
Balanced, Deep, and custom models retain a second model call that independently
reviews topic organization. Help uses one request in every mode. All return
validated complete JSON before displaying the result; streaming is not enabled.
Lowering an output cap is not a reliable speed control and can cut off answers,
so the 6,000-token writer and 3,000-token organizer/Help caps are unchanged.

Help sends at most two recently referenced historical screenshots beside the
current screenshot. Byte-identical images with identical dimensions are included
only once, retaining every included source's ID, timestamp, metadata, and mark
ownership. Changed screens still get their own image; historical annotations
never become valid on a newer capture just because its pixels match.

Bounded live checks on November 5 used Spark 1.3 / Minimal. Before this change,
a one-sentence Chat question took 3.73 seconds for writing and 3.53 seconds for
organization (about 7.25 seconds combined). The same prompt afterward used one
call and took 2.94 seconds. A separate detailed follow-up created three topics
in 11.50 seconds; its synthesis created a new topic linked to all three originals
in 7.04 seconds. The original topics were preserved. These single observations
verify the request path and graph structure, not a general latency or factual
accuracy guarantee. Longer output still takes time.

The checks succeeded with the configured key and did not reproduce an account
billing restriction. Provider allowance or billing errors still need account-side
resolution; switching effort does not bypass them.

The main process checks the configured account's `/models` endpoint before
showing choices, caching the result for one minute. Only supported text-and-image
models are offered. Contributor models are excluded because their data terms
differ; image generation and transcription models cannot answer these requests.
A failed lookup or unavailable model keeps the current choice unchanged. Custom
API providers keep their configured model; their model ID is edited in Settings.

`select-model` accepts a known choice ID, checks account availability, and saves
only the model and reasoning settings. It never rewrites the API key or shortcut.
Settings changes are broadcast to both windows. The request captures the model
and credential before screen capture or source retrieval; Chat's answer writer
and its organizer, when used, share the same captured model and effort. Help does too.
Switching is blocked during an answer or another settings write.

Existing preferences without a reasoning setting use Medium. A previously saved
custom model ID is preserved. Manual model/provider changes in Settings reset
reasoning to Medium; editing other settings preserves the selected effort.
The web server still defaults to Low and can be configured with
`MODEL_API_REASONING_EFFORT`; native choices do not change the separate web app.

Implementation: `desktop/models.ts`, `desktop/main.ts`,
`desktop/renderer/ModelSelector.tsx`, `src/lib/provider.ts`, and
`desktop/help-model.ts`. Tests cover account filtering, safe failure, persistence,
cross-window synchronization, and outbound model/effort in all three request
stages.

Provider references: [models](https://dev.meta.ai/docs/models),
[reasoning effort](https://dev.meta.ai/docs/reasoning),
[streaming protocol](https://dev.meta.ai/docs/protocols/chat-completions). Muse Wonder's API offering
is Standard mode; Full mode is not offered by this chooser.
