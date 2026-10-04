// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TagSettingsSection from "./settings";

const sdk = vi.hoisted(() => ({
  settings: { language: "de" },
  rpc: { call: vi.fn() },
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useSettings: () => ({ values: sdk.settings, isLoading: false }),
  useRpc: () => sdk.rpc,
  useRealtime: () => undefined,
}));
vi.mock("@/components/ui/icon", () => ({ Icon: () => null }));

beforeEach(() => {
  sdk.settings = { language: "de" };
  sdk.rpc.call.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(cleanup);

describe("translated tag rule errors", () => {
  it("maps a rejected tag_rules_get fetch failure to German without raw SDK text", async () => {
    const cause = new Error("Failed to fetch");
    sdk.rpc.call.mockRejectedValue(cause);
    render(<TagSettingsSection />);
    expect(await screen.findByText("Tags konnten nicht geladen werden: Verbindung zum Server fehlgeschlagen.")).toBeTruthy();
    expect(sdk.rpc.call).toHaveBeenCalledWith("tag_rules_get", null);
    expect(document.body.textContent).not.toContain(cause.message);
    expect(console.error).toHaveBeenCalledWith("Could not load tag rules", cause);
  });

  it("shows a German generic load error for an unknown rejection", async () => {
    sdk.rpc.call.mockRejectedValue(new Error("Unexpected SDK detail"));
    render(<TagSettingsSection />);
    expect(await screen.findByText("Tags konnten nicht geladen werden: Ein unerwarteter Fehler ist aufgetreten.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("Unexpected SDK detail");
  });

  it("retranslates a stored load error when the language changes without another RPC", async () => {
    sdk.rpc.call.mockRejectedValue(new Error("Failed to fetch"));
    const view = render(<TagSettingsSection />);
    await screen.findByText("Tags konnten nicht geladen werden: Verbindung zum Server fehlgeschlagen.");
    sdk.settings = { language: "en" };
    view.rerender(<TagSettingsSection />);
    expect(screen.getByText("Could not load tags: Could not connect to the server.")).toBeTruthy();
    expect(sdk.rpc.call).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain("Failed to fetch");
  });

  it.each([
    [Object.assign(new Error("rpc input validation failed"), { code: "invalid_input" }), "Der Server hat die Tag-Regeln abgelehnt.", "The server rejected the tag rules."],
    [new Error("Failed to fetch"), "Verbindung zum Server fehlgeschlagen.", "Could not connect to the server."],
    [new Error("Unexpected SDK detail"), "Ein unerwarteter Fehler ist aufgetreten.", "An unexpected error occurred."],
  ])("translates and retranslates a stored save error (%s)", async (cause, german, english) => {
    sdk.rpc.call.mockImplementation((method) => method === "tag_rules_get"
      ? Promise.resolve({ rules: [] }) : Promise.reject(cause));
    const view = render(<TagSettingsSection />);
    await screen.findByText("Noch keine Tag-Farben.");
    fireEvent.click(screen.getByRole("button", { name: "Tag hinzufügen" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Tag-Name" }), { target: { value: "Bug" } });
    fireEvent.click(screen.getByRole("radio", { name: "Rot" }));
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await screen.findByText(`Speichern fehlgeschlagen: ${german}`);
    expect(sdk.rpc.call).toHaveBeenCalledWith("tag_rules_set", { rules: [{ tag: "Bug", color: "red" }] });
    expect(document.body.textContent).not.toContain(cause.message);
    expect(console.error).toHaveBeenCalledWith("Could not save tag rules", cause);
    sdk.settings = { language: "en" };
    view.rerender(<TagSettingsSection />);
    expect(screen.getByText(`Could not save: ${english}`)).toBeTruthy();
    expect(sdk.rpc.call).toHaveBeenCalledTimes(2);
  });
});
