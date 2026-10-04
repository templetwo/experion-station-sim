<!-- @artifact dev -->
# 3.1.0 golden baseline - archived, read-only

These 40 files are byte-for-byte copies of every golden fixture under `tests/fixtures/` (the eight drills, thirteen upsets, `arch/` and `u4/`) as they stood at `1f0147e`, the merge-base of the credibility-pass branch with main, before stage S1 re-captured any of them (`docs/dev/CREDIBILITY-PASS-SPEC.md` section 11, CR10).
They freeze what the 3.1.0 plant did, so "which fixture moved since 3.1.0, and why" stays answerable once the live goldens are re-captured; `v2-baseline/` beside it is the older archive and is untouched.
Nothing reads them at test time except `tests/v2-baseline-archive.test.js`, which checks the sha256 table below and that every live fixture equals its copy unless it is listed there as re-captured; never edit these files.

| file | sha256 |
|---|---|
| `arch/A1.json` | `f28344c35124d47d1bd141cd7d664d8c0311764bcb788ce668fdf2921338289c` |
| `arch/A10.json` | `34c3da41dede55f8edf833bf151d02c2f2d55194fdfcb544b223126c2f44df75` |
| `arch/A11.json` | `0f9ad5cb058de0d95cb44956c60d6c005a13408c6aacffd723b52b0eacd0c39d` |
| `arch/A12.json` | `b797464131ebf683d70857a42f796b4216695015df61254a83d9efbb1fc71a88` |
| `arch/A1_gated.json` | `daa0e3a4da6a13398a1684430e974ee409f66d0d13d111dea9b68d5e08443605` |
| `arch/A2.json` | `e7a538ba7eb0725abc11d322abace29ffc4c3f39761e29cf6bddf4ff069b99e2` |
| `arch/A3.json` | `6973e8f03898be26a7ed368b9d2864444e9eb8e65aff809f1cd4b60abdf7b7f1` |
| `arch/A4.json` | `8237ebcc4500817a708606ba060c6fa967e14bc6d6282a469cc50d2fe795880c` |
| `arch/A5.json` | `57aef325d8fefb6e208f2866d8e8f05b410da5e84ea41a0fab79781ce52602f6` |
| `arch/A6.json` | `6a8c2f763c80a88e1d4e7e590db80318b5a79a2e982190c4eb43fc45c735132e` |
| `arch/A6_gated.json` | `6af96b84e439ed450b86950096d38070c3867e8c057a3c0ea802264258228c86` |
| `arch/A7.json` | `627c3d4731ca7f7ec7ff07a2e4259029e389a97f224e5bdf143b17f6572ed3bd` |
| `arch/A8.json` | `b6ea9d7517c89d997efc443210ab543be2ec737b4de02987d145df321b709841` |
| `arch/A9.json` | `a3e82960b43b2ad6616416228fa2717e8175957979d2331f0611b6f2f3cb33f9` |
| `drill-D1.json` | `5c2018ee33d2883ac89bca5796f373547437f702530201a47bbed4c98fab701e` |
| `drill-D11.json` | `2c87692c5e36970030633425ae9f2ee0ce1b6ab87f14b740a36e56ec98bcfba1` |
| `drill-D12.json` | `4a9c766fae5b74ae8773b47ffd047bd1aa280362621fdb5670cb26b0d833878a` |
| `drill-D2.json` | `c065cf15129bc26df8204791f204436c24f29daf4208c26726bff078ba056e8a` |
| `drill-D3.json` | `272296a3ed3c7ca2a0fc832e90459abd0583dd90e0e91e3a60be5e6a30734ae5` |
| `drill-D4.json` | `57b6da1ac311edd1d307b1047588e1ffef0848a66ac8353551a1d134bcd8baef` |
| `drill-D6.json` | `c54cd66158b30d8493fc44d478501c1f34eb402831fe07f01201d54c917edfee` |
| `drill-D9.json` | `9c3e0051f52c75b0b1d96b5f32339a5b25bb138f366cfba5213fb4f56e49c2a5` |
| `u4/u4-air-loss.json` | `8e22593bd4e6fca236c29c170175d114f5150a7077fff98529d7795b7fb0175b` |
| `u4/u4-design.json` | `c809d43295bcdc4162aa2d97d687ac087a074425c69793e3dc4254c87ec54417` |
| `u4/u4-interface-high.json` | `70334fa8caceeead7a29ac01181b7da779c2583dfa170cabb1a41f101ca86225` |
| `u4/u4-vent-closed-psv.json` | `93ad40914cb5c0d1bf39aa68837fa01a876abbffdd8bda45fba1c9933d12c39c` |
| `u4/u4-weir-raised.json` | `7aac078dfd5f68c9888dd0298b9ad1b1d2f5387bba94b95516f399cb35abd901` |
| `upset-agit-batch.json` | `7c88730e51a211bc21de530620e0b4651093e66cf65a3f8f57becd1fcdead265` |
| `upset-agit.json` | `a2df9304d912396aaf81825beeba557013936b300f217d485debc8e6b891561e` |
| `upset-air.json` | `6476bc79f3b2798d5905b2aaabb1b2fe2a8cab4cb289b32ce15a71c5ea4dd5e7` |
| `upset-bedact.json` | `e01bfb47724253e7f3ab78f03d4335ad23ff0303eb3b2378b9e05181f8952ad5` |
| `upset-cool.json` | `22ce9fa1d719839e5f6ac0f6dceb6df9b4aa1396966b7a36cb5a918d0b28d419` |
| `upset-drift.json` | `31f9fd89dfeb3bbf5f0e044909fc93c58e9ecef9974b6ae4ca5386aa0533d68d` |
| `upset-foul.json` | `b6cf7ab54ca609a5f77936a9cb5ace0ff44f9c41c280537aef5c0bc9ec555a0c` |
| `upset-pump.json` | `593e388c1d33f75e229465eb0c24885a7c507323b7bdd0387696af56d82d7d27` |
| `upset-rxn.json` | `a5412c63b0bf9267746b27329e46f221b51488388022c46273820e5b6ed8a623` |
| `upset-stick.json` | `5284205cb0e58746472fb608111abad7dddd7e2cf08c58f3ef778b1e3c0566a4` |
| `upset-surge.json` | `4adafe0030bd961222a6e1e67d5544e9850862ec57c16a41eeef255f5091898d` |
| `upset-vap.json` | `6abab78bf1c27736d9714ab83aae9e0a19f5999f9d3476b173024e4eae27e3ac` |
| `upset-xmtr.json` | `f909db8b37fed19be715fcb62cc1a7c89a563d6aea32c2bd198e9859ce556a47` |
