import { describe, expect, it } from "vitest";
import { RouteProviderNotConfiguredError, UnconfiguredRouteProvider } from "./routing";

describe("UnconfiguredRouteProvider", () => {
  it("does not invent a road distance or duration", async () => {
    const provider = new UnconfiguredRouteProvider();

    await expect(
      provider.estimate({
        origin: { latitude: "33.500000", longitude: "36.300000" },
        destination: { latitude: "33.510000", longitude: "36.310000" },
      }),
    ).rejects.toBeInstanceOf(RouteProviderNotConfiguredError);
    await expect(provider.route([{ latitude: "33.5", longitude: "36.3" }, { latitude: "33.51", longitude: "36.31" }])).rejects.toBeInstanceOf(
      RouteProviderNotConfiguredError,
    );
    await expect(
      provider.distanceMatrix([
        { latitude: "33.5", longitude: "36.3" },
        { latitude: "33.51", longitude: "36.31" },
      ]),
    ).rejects.toBeInstanceOf(RouteProviderNotConfiguredError);
  });
});
