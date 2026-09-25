// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Preloaded into the contract's Adminium (`node --import`): the server's clock
 * starts at `CONTRACT_NOW` (epoch ms) and runs on from there.
 *
 * The contract adds the sample at the moment the sample's own figures are
 * written for — 10:00 on Tuesday 28 July 2026 at the studio — so every figure
 * it asserts is the literal one, on every engine. Only JavaScript's clock
 * moves; the server reads its "now" from it.
 *
 * Time can also pass at once, as a night passes over a clock left running:
 * on SIGUSR2 the clock moves on by the milliseconds written in
 * `CONTRACT_CLOCK_FILE`, and the file is then emptied to say it has moved.
 */
import { readFileSync, writeFileSync } from "node:fs";

const target = Number(process.env.CONTRACT_NOW);
if (Number.isFinite(target)) {
  const RealDate = Date;
  let offset = target - RealDate.now();
  class ContractDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...args);
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = ContractDate;
  const file = process.env.CONTRACT_CLOCK_FILE;
  if (file !== undefined && file !== "") {
    process.on("SIGUSR2", () => {
      const by = Number(readFileSync(file, "utf8").trim());
      if (Number.isFinite(by)) offset += by;
      writeFileSync(file, "");
    });
  }
}
