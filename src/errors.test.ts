import { describe, it, expect } from "vitest";
import {
  DiscordErrorCode,
  discordError,
  validationError,
} from "./errors.js";

describe("DiscordErrorCode", () => {
  it("UNKNOWN_CHANNELが10003であること", () => {
    expect(DiscordErrorCode.UNKNOWN_CHANNEL).toBe(10003);
  });

  it("UNKNOWN_GUILDが10004であること", () => {
    expect(DiscordErrorCode.UNKNOWN_GUILD).toBe(10004);
  });

  it("INVALID_FORM_BODYが50035であること", () => {
    expect(DiscordErrorCode.INVALID_FORM_BODY).toBe(50035);
  });
});

describe("discordError", () => {
  it("message・code・statusを持つオブジェクトを返すこと", () => {
    const err = discordError(10003, "Unknown Channel", 404);
    expect(err).toEqual({
      body: { message: "Unknown Channel", code: 10003 },
      status: 404,
    });
  });
});

describe("validationError", () => {
  it("errorsフィールドを含む50035エラーを返すこと", () => {
    const errors = {
      content: {
        _errors: [{ code: "BASE_TYPE_MAX_LENGTH", message: "Must be 2000 or fewer in length." }],
      },
    };
    const err = validationError(errors);
    expect(err).toEqual({
      body: {
        message: "Invalid Form Body",
        code: 50035,
        errors,
      },
      status: 400,
    });
  });
});
