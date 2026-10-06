// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SettingsWebPushSection } from "./SettingsWebPushSection.js";

/**
 * Tests for per-device Web Push enrollment in Settings. jsdom has no service worker
 * or Push API, so each test installs only the browser surface it needs.
 */

const mockApi = vi.hoisted(() => ({
  getWebPushInfo: vi.fn(),
  subscribeWebPush: vi.fn(),
  unsubscribeWebPush: vi.fn(),
  testWebPush: vi.fn(),
}));

vi.mock("../api.js", () => ({ api: mockApi }));

const ENDPOINT = "https://web.push.apple.com/device";
// base64url of bytes [1, 2, 3, 4]
const PUBLIC_KEY = "AQIDBA";
const sectionSearchProps = { hidden: false, searchQuery: "", matchCount: 0 };

function installPushBrowser(existingSubscription: PushSubscription | null = null) {
  const subscription = {
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: "p", auth: "a" } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  } as unknown as PushSubscription;
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(existingSubscription),
    subscribe: vi.fn().mockResolvedValue(subscription),
  };
  const registration = { pushManager } as unknown as ServiceWorkerRegistration;
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register: vi.fn().mockResolvedValue(registration) },
  });
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", { permission: "default" });
  return { pushManager, subscription };
}

describe("SettingsWebPushSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getWebPushInfo.mockResolvedValue({ available: true, publicKey: PUBLIC_KEY, subscriptionCount: 0 });
    mockApi.subscribeWebPush.mockResolvedValue({ ok: true, subscriptionCount: 1 });
    mockApi.unsubscribeWebPush.mockResolvedValue({ ok: true, subscriptionCount: 0 });
    mockApi.testWebPush.mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  it("tells iPhone Safari users to open Takode from the Home Screen", async () => {
    // iOS Safari tabs have no PushManager; only the Home Screen app can subscribe.
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1",
    );
    render(<SettingsWebPushSection sectionSearchProps={sectionSearchProps} />);
    expect(await screen.findByText(/add Takode to your Home Screen/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enable on this device" })).not.toBeInTheDocument();
  });

  it("subscribes with the server key, registers the subscription, and starts presence reporting", async () => {
    const { pushManager } = installPushBrowser();
    render(<SettingsWebPushSection sectionSearchProps={sectionSearchProps} />);

    const enable = await screen.findByRole("button", { name: "Enable on this device" });
    await waitFor(() => expect(enable).toBeEnabled());
    fireEvent.click(enable);

    // subscribe() runs synchronously inside the tap so iOS shows its permission prompt.
    expect(pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array([1, 2, 3, 4]),
    });
    expect(await screen.findByText("Notifications enabled on this device.")).toBeInTheDocument();
    expect(mockApi.subscribeWebPush).toHaveBeenCalledWith({ endpoint: ENDPOINT, keys: { p256dh: "p", auth: "a" } });
    expect(fetch).toHaveBeenCalledWith(
      "/api/web-push/presence",
      expect.objectContaining({ body: JSON.stringify({ endpoint: ENDPOINT, visible: true }) }),
    );
    expect(screen.getByText(/1 device subscribed/)).toBeInTheDocument();
  });

  it("sends a self-retracting test and can disable an existing subscription", async () => {
    const { subscription } = installPushBrowser();
    installPushBrowser(subscription);
    mockApi.getWebPushInfo.mockResolvedValue({ available: true, publicKey: PUBLIC_KEY, subscriptionCount: 1 });
    render(<SettingsWebPushSection sectionSearchProps={sectionSearchProps} />);

    fireEvent.click(await screen.findByRole("button", { name: "Send Test" }));
    expect(await screen.findByText(/should disappear about 20s/)).toBeInTheDocument();
    expect(mockApi.testWebPush).toHaveBeenCalledWith(ENDPOINT, 20);

    fireEvent.click(screen.getByRole("button", { name: "Disable on this device" }));
    expect(await screen.findByText("Notifications disabled on this device.")).toBeInTheDocument();
    expect(mockApi.unsubscribeWebPush).toHaveBeenCalledWith(ENDPOINT);
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(screen.getByText(/0 devices subscribed/)).toBeInTheDocument();
  });
});
