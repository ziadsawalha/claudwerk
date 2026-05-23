# Spike: dispatch op -- 2026-05-23T06:51:07.855Z

Live recon against the running daemon. Pattern: each probe dispatches a Haiku worker (or attempts to), then `claude rm`s it in finally.
No daemon control socket -- dispatching a kick-start worker to wake the supervisor.
Kick-started worker c2ad22da. Waiting for daemon to settle...
  cleaned up c2ad22da
daemon ping: {"ok":true,"op":"ping","version":"2.1.148","proto":1}

## Probe 1 -- prompt mode, empty args

[P1] short=cb2892db nonce=08c8b601 mode=prompt
[P1] req={"op":"dispatch","d":{"proto":1,"short":"cb2892db","nonce":"08c8b601","sessionId":"df140babfa311efb1c4c30f77e6d231d","createdAt":1779519070513,"source":"shell","cwd":"/var/folders/pf/kvc_rrrs6m5g83_rv
[P1] resp={"ok":true,"op":"dispatch","short":"cb2892db","pid":57183,"messagingSock":"","via":"spare"}

## Probe 2 -- prompt mode, simple prompt

[P2] short=2792b774 nonce=71d7cd4e mode=prompt
[P2] req={"op":"dispatch","d":{"proto":1,"short":"2792b774","nonce":"71d7cd4e","sessionId":"c4a18787cbce19e295b633b242b5d412","createdAt":1779519070518,"source":"shell","cwd":"/var/folders/pf/kvc_rrrs6m5g83_rv
[P2] resp={"ok":true,"op":"dispatch","short":"2792b774","pid":57420,"messagingSock":"","via":"spare"}

## Probe 3 -- prompt mode, slash-only

[P3] short=e281d889 nonce=d725a2db mode=prompt
[P3] req={"op":"dispatch","d":{"proto":1,"short":"e281d889","nonce":"d725a2db","sessionId":"467d26046fe3e88dbfe1ac9a93f56090","createdAt":1779519070523,"source":"shell","cwd":"/var/folders/pf/kvc_rrrs6m5g83_rv
[P3] resp={"ok":true,"op":"dispatch","short":"e281d889","pid":57423,"messagingSock":"","via":"spare"}

## Probe 4 -- resume mode, fork:false

P4 seed worker dispatched: be0f2061
P4 seed list: {"short":"be0f2061","nonce":"05363c6c","sessionId":"be0f2061-c506-4e15-bf38-7811bf21a89a","pid":57426,"attempt":1,"startedAt":1779519071105,"cwd":"/private/var/folders/pf/kvc_rrrs6m5g83_rvgr7thp00000gn/T/dispatch-spike-p4-seed-S7JFxo","backend":"daemon","tempo":"active","state":"running","detail":"","intent":"reply SEED-OK","name":"dispatch-spike-p4-seed-3ff5ff9c","cliVersion":"2.1.148","source":"shell"}
[P4] short=a3862ede nonce=e5867c5e mode=resume
[P4] req={"op":"dispatch","d":{"proto":1,"short":"a3862ede","nonce":"e5867c5e","sessionId":"d7ef50eaf0c14f8b5459d7a31c4a32cc","createdAt":1779519073141,"source":"shell","cwd":"/var/folders/pf/kvc_rrrs6m5g83_rv
[P4] resp={"ok":true,"op":"dispatch","short":"a3862ede","pid":57510,"messagingSock":"","via":"spare"}
P4 resumed worker job: undefined
P4 conclusion: dispatched.sessionId === seed.sessionId? false

## Probe 5 -- exec mode

[P5] short=05af92c1 nonce=29c15082 mode=exec
[P5] req={"op":"dispatch","d":{"proto":1,"short":"05af92c1","nonce":"29c15082","sessionId":"0c4cab1af16fe2c7ac0580109bdb6975","createdAt":1779519075150,"source":"shell","cwd":"/var/folders/pf/kvc_rrrs6m5g83_rv
[P5] resp={"ok":true,"op":"dispatch","short":"05af92c1","pid":0,"messagingSock":"","via":"cold"}

## Probe 6 -- prompt mode + seed.intent + agent + routine

[P6] short=87cc59fe nonce=b0495c10 mode=prompt
[P6] req={"op":"dispatch","d":{"proto":1,"short":"87cc59fe","nonce":"b0495c10","sessionId":"473758cf81b597d8e043c630c8374e81","createdAt":1779519075153,"source":"shell","cwd":"/var/folders/pf/kvc_rrrs6m5g83_rv
[P6] resp={"ok":true,"op":"dispatch","short":"87cc59fe","pid":58158,"messagingSock":"","via":"spare"}
P6 list entry: {"short":"87cc59fe","nonce":"b0495c10","sessionId":"473758cf81b597d8e043c630c8374e81","pid":58158,"attempt":1,"startedAt":1779519075160,"cwd":"/var/folders/pf/kvc_rrrs6m5g83_rvgr7thp00000gn/T/dispatch-spike-p6-FSUMxY","backend":"daemon","tempo":"active","state":"running","detail":"","intent":"claudewerk-research-spike","name":"P6 probe","agent":"general-purpose","routine":"dispatch-spike","cliVersion":"2.1.148","source":"shell"}

## Probe 7 -- isolation:worktree + worktree.ownershipToken

[P7] short=ef75e296 nonce=6dbe6904 mode=prompt
[P7] req={"op":"dispatch","d":{"proto":1,"short":"ef75e296","nonce":"6dbe6904","sessionId":"7a4097d21cfb917aff043eb15b7fab55","createdAt":1779519076664,"source":"shell","cwd":"/var/folders/pf/kvc_rrrs6m5g83_rv
[P7] resp={"ok":true,"op":"dispatch","short":"ef75e296","pid":58217,"messagingSock":"","via":"spare"}

## Probe 8 -- respawnFlags + attachStallRespawns

[P8] short=10409f02 nonce=c8fd8ccd mode=prompt
[P8] req={"op":"dispatch","d":{"proto":1,"short":"10409f02","nonce":"c8fd8ccd","sessionId":"644b49be0322f161941a01fee79ad2b7","createdAt":1779519076669,"source":"shell","cwd":"/var/folders/pf/kvc_rrrs6m5g83_rv
[P8] resp={"ok":true,"op":"dispatch","short":"10409f02","pid":58771,"messagingSock":"","via":"spare"}

## Probe 9 -- source enum coverage

[P9-shell] short=3091ada7 nonce=9d116947 mode=prompt
[P9-shell] req={"op":"dispatch","d":{"proto":1,"short":"3091ada7","nonce":"9d116947","sessionId":"8ae3e08e4c1012314aa9abe588e86131","createdAt":1779519076674,"source":"shell","cwd":"/var/folders/pf/kvc_rrrs6m5g83_rv
[P9-shell] resp={"ok":true,"op":"dispatch","short":"3091ada7","pid":58774,"messagingSock":"","via":"spare"}
[P9-slash] short=eaa4378d nonce=5a106f7d mode=prompt
[P9-slash] req={"op":"dispatch","d":{"proto":1,"short":"eaa4378d","nonce":"5a106f7d","sessionId":"ff18be017afbc835f925cfa7e815328d","createdAt":1779519076678,"source":"slash","cwd":"/var/folders/pf/kvc_rrrs6m5g83_rv
[P9-slash] resp={"ok":true,"op":"dispatch","short":"eaa4378d","pid":58777,"messagingSock":"","via":"spare"}
[P9-fleet] short=8f029fa7 nonce=cdce452a mode=prompt
[P9-fleet] req={"op":"dispatch","d":{"proto":1,"short":"8f029fa7","nonce":"cdce452a","sessionId":"94c305481811fc6a4d8f9275caa27e46","createdAt":1779519076696,"source":"fleet","cwd":"/var/folders/pf/kvc_rrrs6m5g83_rv
[P9-fleet] resp={"ok":true,"op":"dispatch","short":"8f029fa7","pid":58780,"messagingSock":"","via":"spare"}
[P9-spare] short=3acdbc09 nonce=f6e69b69 mode=prompt
[P9-spare] req={"op":"dispatch","d":{"proto":1,"short":"3acdbc09","nonce":"f6e69b69","sessionId":"b03c1b78f957248f097efc10d8841656","createdAt":1779519076711,"source":"spare","cwd":"/var/folders/pf/kvc_rrrs6m5g83_rv
[P9-spare] resp={"ok":true,"op":"dispatch","short":"3acdbc09","pid":58808,"messagingSock":"","via":"spare"}
[P9-respawn] short=645f348f nonce=847d5bd0 mode=prompt
[P9-respawn] req={"op":"dispatch","d":{"proto":1,"short":"645f348f","nonce":"847d5bd0","sessionId":"a1d89ea5e26dc2f5c90c3de785224e28","createdAt":1779519076721,"source":"respawn","cwd":"/var/folders/pf/kvc_rrrs6m5g83_
[P9-respawn] resp={"ok":true,"op":"dispatch","short":"645f348f","pid":58820,"messagingSock":"","via":"spare"}

## Cleanup

  claude rm cb2892db exited 1: No job matching 'cb2892db'

  cleaned up 2792b774
  claude rm e281d889 exited 1: No job matching 'e281d889'

  cleaned up be0f2061
  claude rm a3862ede exited 1: No job matching 'a3862ede'

  cleaned up 05af92c1
  cleaned up 87cc59fe
  claude rm ef75e296 exited 1: No job matching 'ef75e296'

  cleaned up 10409f02
  cleaned up 3091ada7
  cleaned up eaa4378d
  cleaned up 8f029fa7
  cleaned up 3acdbc09
  cleaned up 645f348f

Spike complete.
