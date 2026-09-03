<!-- @artifact dev -->
# v2 golden baseline — archived, read-only

These 21 files are byte-for-byte copies of the S0 golden fixtures (`tests/fixtures/*.json`)
as captured at commit f8301fb on 2026-08-30 ("golden baseline freezing v2 behaviour before
any v3 change") and as they stood on 2026-09-03 at v3 commit da61263, immediately before the
first deliberate re-capture. They freeze what the v2 plant did: the exact end state, alarm
sequence, trips, faults and scored outcome of eight drills and thirteen instructor upsets.

Why they are here: `docs/dev/P2L-EXPANSION-SPEC.md` section 10, question 2. Re-capturing a
golden destroys the only record of what v2 did. Anthony chose option A on 2026-09-03: archive
the originals first, then re-capture deliberately with a written justification each time.

Nothing reads these files at test time except `tests/v2-baseline-archive.test.js`, which
checks that they have not changed (the sha256 list below is the record). To compare a live
run against v2 behaviour, point the golden tests at this directory by hand; do not edit
these files, ever. If v2 behaviour must be re-derived, it is here.

| file | sha256 |
|---|---|
| `drill-D1.json` | `5c2018ee33d2883ac89bca5796f373547437f702530201a47bbed4c98fab701e` |
| `drill-D11.json` | `2c87692c5e36970030633425ae9f2ee0ce1b6ab87f14b740a36e56ec98bcfba1` |
| `drill-D12.json` | `d5b29e051351c09a67fca37f130b2119f3cc2adb4a0a412e4a0aa4051e5985c1` |
| `drill-D2.json` | `c065cf15129bc26df8204791f204436c24f29daf4208c26726bff078ba056e8a` |
| `drill-D3.json` | `272296a3ed3c7ca2a0fc832e90459abd0583dd90e0e91e3a60be5e6a30734ae5` |
| `drill-D4.json` | `57b6da1ac311edd1d307b1047588e1ffef0848a66ac8353551a1d134bcd8baef` |
| `drill-D6.json` | `c54cd66158b30d8493fc44d478501c1f34eb402831fe07f01201d54c917edfee` |
| `drill-D9.json` | `9c3e0051f52c75b0b1d96b5f32339a5b25bb138f366cfba5213fb4f56e49c2a5` |
| `upset-agit-batch.json` | `7c88730e51a211bc21de530620e0b4651093e66cf65a3f8f57becd1fcdead265` |
| `upset-agit.json` | `a2df9304d912396aaf81825beeba557013936b300f217d485debc8e6b891561e` |
| `upset-air.json` | `5e952142fc6832064f9baf7ac47189a00c2ce833395094815b026d2f2323c28c` |
| `upset-bedact.json` | `03568376cd3ec1caa50df29f3da52d692d3b3eaa41b6144f6c30a3c6cb9ddeac` |
| `upset-cool.json` | `22ce9fa1d719839e5f6ac0f6dceb6df9b4aa1396966b7a36cb5a918d0b28d419` |
| `upset-drift.json` | `31f9fd89dfeb3bbf5f0e044909fc93c58e9ecef9974b6ae4ca5386aa0533d68d` |
| `upset-foul.json` | `b6cf7ab54ca609a5f77936a9cb5ace0ff44f9c41c280537aef5c0bc9ec555a0c` |
| `upset-pump.json` | `593e388c1d33f75e229465eb0c24885a7c507323b7bdd0387696af56d82d7d27` |
| `upset-rxn.json` | `a5412c63b0bf9267746b27329e46f221b51488388022c46273820e5b6ed8a623` |
| `upset-stick.json` | `5284205cb0e58746472fb608111abad7dddd7e2cf08c58f3ef778b1e3c0566a4` |
| `upset-surge.json` | `4adafe0030bd961222a6e1e67d5544e9850862ec57c16a41eeef255f5091898d` |
| `upset-vap.json` | `6abab78bf1c27736d9714ab83aae9e0a19f5999f9d3476b173024e4eae27e3ac` |
| `upset-xmtr.json` | `f909db8b37fed19be715fcb62cc1a7c89a563d6aea32c2bd198e9859ce556a47` |
