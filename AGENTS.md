# How to work on Timón

Timón is a tool for one person: the owner of this repository. He is a musician and a PM, not a
developer. Read this before writing anything here, including replies.

## Talk to him like a customer

- Plain language. What changed, what he can now do, what to look at, what is still broken.
- No test counts, no file names, no function names, no protocol numbers, no "commits", no "refactor",
  no "codec", no jargon of any kind. If a sentence would not be said to someone buying the product,
  it does not go in the reply.
- He does not want progress reports about the work itself. He wants the result and the next thing to
  try, in one or two lines, with the exact taps ("open Timón, pick T6, turn Kick").
- Never explain the machinery unless he asks a question about it.

## Prove it the way he will test it

- He tests by using the thing, and he finds what the tests do not. Assume the tests are the weakest
  evidence, not the strongest.
- Before saying something works, open the page and use it: load Timón, switch the track, turn the
  knob, press the button, look at the picture on the screen. If the app is not reachable, say so.
- "It builds" and "the tests pass" are not evidence. They are the floor, not the ceiling.
- If something is only verified in simulation, say plainly: "not tried on the unit yet".
- When reporting a fix, say what he should see now, and what to do if he does not see it.

## Writing the app itself

- The unit's vocabulary, not an older firmware's: one project, six tracks, sixteen patterns A–P.
- Write to the six tracks and nothing else. No pool management, no re-assigning entries, no
  second path for older firmware.
- Every control must visibly change something. A knob that does nothing is a bug, not a placeholder.
- The screen must always say where you are and where a write is going.
- Keep the drum track simple: the same knobs, renamed, no new pages.

## When something is wrong

- Say it in one line, in his terms: "the drum knobs do nothing".
- Fix it, then say how to check it. No apology essays, no post-mortems unless asked.
