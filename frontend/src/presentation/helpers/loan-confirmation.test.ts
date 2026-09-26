import { describe, expect, it } from "vitest";
import { getLoanConfirmationSummary, getLoanCreatedToastMessage } from "./loan-confirmation";

describe("loan confirmation helpers", () => {
  it("builds the dynamic confirmation summary", () => {
    expect(getLoanConfirmationSummary({
      principal: "125000",
      interestAmount: "12500",
      total: "137500",
      planCount: 6,
      disbursementMethod: "Transferencia",
    })).toEqual([
      ["Capital", "₡125.000,00"],
      ["Interés", "₡12.500,00"],
      ["Total a pagar", "₡137.500,00"],
      ["Cuotas programadas", "6"],
      ["Forma de desembolso", "Transferencia"],
      ["Desembolso real", "₡125.000,00"],
    ]);
  });

  it("keeps the created-loan toast message explicit", () => {
    expect(getLoanCreatedToastMessage(42)).toBe("Préstamo #42 creado correctamente.");
  });
});
