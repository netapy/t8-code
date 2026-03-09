import { afterEach, assert, describe, it, vi } from "vitest";

import { createUuid, isWindowsPlatform } from "./utils";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isWindowsPlatform", () => {
  it("matches Windows platform identifiers", () => {
    assert.isTrue(isWindowsPlatform("Win32"));
    assert.isTrue(isWindowsPlatform("Windows"));
    assert.isTrue(isWindowsPlatform("windows_nt"));
  });

  it("does not match darwin", () => {
    assert.isFalse(isWindowsPlatform("darwin"));
  });
});

describe("createUuid", () => {
  it("falls back to getRandomValues when randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: <T extends ArrayBufferView>(buffer: T): T => {
        new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength).set(
          Uint8Array.from({ length: buffer.byteLength }, (_, index) => index + 1),
        );
        return buffer;
      },
    } satisfies Pick<Crypto, "getRandomValues">);

    const uuid = createUuid();
    assert.match(
      uuid,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("falls back to Math.random when crypto is unavailable", () => {
    vi.stubGlobal("crypto", undefined);
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);

    const uuid = createUuid();

    assert.match(
      uuid,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    randomSpy.mockRestore();
  });
});
