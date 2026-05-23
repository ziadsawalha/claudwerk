# Spike: dispatch Phase 4 cutover -- 2026-05-23T08:32:08.494Z

daemon ping: {"ok":true,"op":"ping","version":"2.1.150","proto":1}

## PART A -- fork decision (resume via socket op)

seed dispatched: c7303977 (cwd=/var/folders/pf/kvc_rrrs6m5g83_rvgr7thp00000gn/T/p4-seed-fKu2CY)
seed job: {"short":"c7303977","nonce":"c98ef353","sessionId":"c7303977-499e-4a19-802a-1cfd910d68e6","pid":3747,"attempt":1,"startedAt":1779525128811,"cwd":"/private/var/folders/pf/kvc_rrrs6m5g83_rvgr7thp00000gn/T/p4-seed-fKu2CY","backend":"daemon","tempo":"active","state":"running","detail":"","intent":"Reply with exactly: SEED-CODEWORD-WALRUS and nothing else.","name":"p4-seed-c43cc00a","cliVersion":"2.1.150","source":"shell"}
[fork:false] dispatch resp: {"ok":true,"op":"dispatch","short":"cc6bd070","pid":78534,"messagingSock":"","via":"spare"}
[fork:false] resumed job: {"short":"cc6bd070","nonce":"887327f8","sessionId":"75e7b60c5f7ddc2c2745e395f1182c85","pid":78534,"attempt":1,"startedAt":1779525135366,"cwd":"/var/folders/pf/kvc_rrrs6m5g83_rvgr7thp00000gn/T/p4-seed-fKu2CY","backend":"daemon","tempo":"active","state":"running","detail":"","intent":"","cliVersion":"2.1.150","source":"fleet"}
[fork:false] resumedSessionId=75e7b60c5f7ddc2c2745e395f1182c85 seedSessionId=c7303977-499e-4a19-802a-1cfd910d68e6 match=false
[fork:true] dispatch resp: {"ok":true,"op":"dispatch","short":"c1eb74a1","pid":79245,"messagingSock":"","via":"spare"}
[fork:true] resumed job: {"short":"c1eb74a1","nonce":"3f74afa8","sessionId":"7dd6c9ec2d2ef38e47adf50e4e5da764","pid":79245,"attempt":1,"startedAt":1779525135710,"cwd":"/var/folders/pf/kvc_rrrs6m5g83_rvgr7thp00000gn/T/p4-seed-fKu2CY","backend":"daemon","tempo":"active","state":"running","detail":"","intent":"","cliVersion":"2.1.150","source":"fleet"}
[fork:true] resumedSessionId=7dd6c9ec2d2ef38e47adf50e4e5da764 seedSessionId=c7303977-499e-4a19-802a-1cfd910d68e6 match=false

## PART A -- conclusion

fork:false preserved the seed sessionId? false
fork:true  preserved the seed sessionId? false

## PART B -- NEW-mode flag passthrough (launch.args carries --model + prompt)

[NEW] dispatch resp: {"ok":true,"op":"dispatch","short":"90e24421","pid":79277,"messagingSock":"","via":"spare"}
[NEW] job: {"short":"90e24421","nonce":"e0c8e7fd","sessionId":"903c32aa863f8ce00cf793ab805f6ac3","pid":79277,"attempt":1,"startedAt":1779525136018,"cwd":"/var/folders/pf/kvc_rrrs6m5g83_rvgr7thp00000gn/T/p4-new-UdNDu6","backend":"daemon","tempo":"active","state":"running","detail":"","intent":"","cliVersion":"2.1.150","source":"fleet"}
[NEW] worker sessionId = 903c32aa863f8ce00cf793ab805f6ac3 (dispatch-supplied = 903c32aa863f8ce00cf793ab805f6ac3)
[NEW] transcript path: /Users/jonas/.claude-work/projects/-private-var-folders-pf-kvc-rrrs6m5g83-rvgr7thp00000gn-T-p4-new-UdNDu6/903c32aa863f8ce00cf793ab805f6ac3.jsonl
[NEW] codeword "NEW-CODEWORD-EC83B74A" in transcript? true
[NEW] assistant message model = null (expected claude-haiku-4-5-20251001)
[NEW] --model honored via launch.args? false

## Cleanup

removed c7303977
removed 90e24421

Spike complete.

## Corrected interpretation (post-run transcript inspection)

### PART B -- flag passthrough: CONFIRMED honored

The in-run `assistant model = null` was a READ-TIMING artifact (the JSONL was
read at the 8s mark before the assistant reply flushed; the codeword was
already present in the user entry, hence codeword=true). Inspecting the
persisted transcript afterwards:

    assistant entries report  model = claude-haiku-4-5-20251001

So `launch.args = ['--model', <model>, '<prompt>']` for prompt mode:
  - runs the trailing positional as the first turn (codeword present), AND
  - honors `--model` (assistant entries use the requested model).

CONFIRMED: the cutover DispatchSpec shape `launch:{mode:'prompt',
args:[...flags, prompt]}` (flags = --model/--settings/--mcp-config/
--append-system-prompt, prompt last) is correct for NEW mode.

### Top-level `sessionId` == the worker's ccSessionId

PART B: the worker's JobRecord.sessionId == the dispatch-supplied top-level
`sessionId` (903c32aa...), and its transcript is written to
`<slug>/903c32aa....jsonl`. So claudewerk MINTS the worker's sessionId in the
DispatchSpec; it is deterministic and known upfront, not daemon-assigned. (The
daemon-agent-host still derives ccSessionId by OBSERVING, so the cutover does
not depend on predicting it -- but the mint is the canonical source.)

### PART A -- fork decision

Both fork:false AND fork:true resumed workers reported a JobRecord.sessionId
equal to the dispatch-supplied top-level `sessionId` (a fresh 32-hex), NOT the
seed's sessionId. So the `fork` flag does NOT change the worker's reported
sessionId -- claudewerk controls it via the dispatch either way. Neither
resumed worker wrote a transcript under its reported id (the resume probes ran
no turn -- flagArgs only, no positional prompt -- so the worker resumed and
idled without a new write).

DECISION: claudewerk RESUME dispatch uses **fork:true**.
  - It is a faithful 1:1 cutover of the proven legacy `claude --bg --resume`
    semantics (which forks by default). The production daemon-agent-host
    session-observer + transcript-bridge and the smoke harness's RESUME
    continuity assertion (`PROBE-NEW-OK` present in the resumed session) are
    built on fork-style continuity; fork:true preserves that contract with
    zero behavior change.
  - The original motivation for fork:false ("preserved sessionId -> simpler
    identity model") is MOOT: claudewerk now supplies the worker's sessionId
    in the dispatch regardless of fork, so the resumed worker's ccSessionId is
    already deterministic. fork:false's in-place-continuation semantics could
    not be positively confirmed here (no turn ran) and pursuing them is scope
    creep for a behavior-preserving cutover.
  - fork:false remains available in the typed DispatchSpec for a future,
    dedicated continuity spike (resume WITH a turn; observe which transcript
    file grows) if claudewerk ever wants true in-place resume.
