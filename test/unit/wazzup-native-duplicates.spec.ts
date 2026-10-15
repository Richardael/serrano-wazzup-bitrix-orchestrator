import { describe, it, expect } from "vitest";
import { pickWazzupNativeDuplicates } from "../../src/application/services/wazzup-native-duplicates";
import { LeadRecord } from "../../src/domain/leads/lead";

const lead = (over: Partial<LeadRecord> & { id: string }): LeadRecord => ({
  title: "",
  statusId: "NEW",
  assignedById: "",
  sourceId: "WHATSAPP",
  phone: "+584120000000",
  createdAt: "2026-10-14T10:00:00+03:00",
  ...over,
});

const WZ = "WZf2071598-110c-4529-a0c8-5bdfdc718957";

describe("pickWazzupNativeDuplicates", () => {
  it("closes the Wazzup native lead when the orchestrator lead exists", () => {
    const a = lead({ id: "1" });
    const b = lead({ id: "2", sourceId: WZ });
    expect(pickWazzupNativeDuplicates([a, b]).map((l) => l.id)).toEqual(["2"]);
  });

  it("also closes it when an Instagram lead is the other one", () => {
    const a = lead({ id: "1", sourceId: "REPEAT_SALE", statusId: "ASSIGNED" });
    const b = lead({ id: "2", sourceId: WZ });
    expect(pickWazzupNativeDuplicates([a, b]).map((l) => l.id)).toEqual(["2"]);
  });

  it("never touches a Wazzup lead that is the only active one", () => {
    expect(pickWazzupNativeDuplicates([lead({ id: "2", sourceId: WZ })])).toEqual([]);
  });

  it("never touches a Wazzup lead somebody already moved", () => {
    const a = lead({ id: "1" });
    const b = lead({ id: "2", sourceId: WZ, statusId: "IN_PROCESS" });
    expect(pickWazzupNativeDuplicates([a, b])).toEqual([]);
  });

  it("does not close anything when no lead is from Wazzup", () => {
    const a = lead({ id: "1" });
    const b = lead({ id: "2", sourceId: "REPEAT_SALE" });
    expect(pickWazzupNativeDuplicates([a, b])).toEqual([]);
  });

  it("never closes two Wazzup leads when there is nothing else to keep", () => {
    const a = lead({ id: "1", sourceId: WZ });
    const b = lead({ id: "2", sourceId: WZ });
    expect(pickWazzupNativeDuplicates([a, b])).toEqual([]);
  });
});
