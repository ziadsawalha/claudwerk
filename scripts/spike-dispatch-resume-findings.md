# Spike: dispatch resume fork:false -- 2026-05-23T06:52:46.055Z

daemon: {"ok":true,"op":"ping","version":"2.1.148","proto":1}
seed worker dispatched: b1b09ff0
seed job: {"short":"b1b09ff0","nonce":"d4994630","sessionId":"b1b09ff0-3013-461b-9ee0-d66b8e4ab165","pid":64895,"attempt":1,"startedAt":1779519171338,"cwd":"/private/var/folders/pf/kvc_rrrs6m5g83_rvgr7thp00000gn/T/resume-spike-seed-K2aHCq","backend":"daemon","tempo":"active","state":"running","detail":"","intent":"reply SEED-CODEWORD-WAFFLE-7392","name":"resume-spike-seed-16fc4687","cliVersion":"2.1.150","source":"shell"}
seed job after wait: {"short":"b1b09ff0","nonce":"d4994630","sessionId":"b1b09ff0-3013-461b-9ee0-d66b8e4ab165","pid":64895,"attempt":1,"startedAt":1779519171338,"cwd":"/private/var/folders/pf/kvc_rrrs6m5g83_rvgr7thp00000gn/T/resume-spike-seed-K2aHCq","backend":"daemon","tempo":"idle","state":"done","detail":"authenticated with seed codeword","intent":"reply SEED-CODEWORD-WAFFLE-7392","name":"resume-spike-seed-16fc4687","cliVersion":"2.1.150","source":"shell","needs":""}
PROBE A (fork:false) dispatch resp: {"ok":true,"op":"dispatch","short":"cf60b3b3","pid":64899,"messagingSock":"","via":"spare"}
PROBE A job after dispatch: null
PROBE A: probe sessionId=undefined vs seed=b1b09ff0-3013-461b-9ee0-d66b8e4ab165 -- match=false
PROBE B (fork:true) dispatch resp: {"ok":true,"op":"dispatch","short":"83e44992","pid":65622,"messagingSock":"","via":"spare"}
PROBE B job after dispatch: null
PROBE B: probe sessionId=undefined vs seed=b1b09ff0-3013-461b-9ee0-d66b8e4ab165 -- match=false

## Cleanup
Done.
