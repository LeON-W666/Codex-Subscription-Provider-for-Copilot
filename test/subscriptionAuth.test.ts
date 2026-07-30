import { describe, expect, it } from "vitest";
import {
  createSubscriptionEnvironment,
  validateChatGptSubscriptionAuth
} from "../src/subscriptionAuth";

describe("validateChatGptSubscriptionAuth", () => {
  it("accepts ChatGPT token authentication", () => {
    expect(() =>
      validateChatGptSubscriptionAuth({
        auth_mode: "chatgpt",
        tokens: { access_token: "subscription-token" }
      })
    ).not.toThrow();
  });

  it("rejects API authentication and stored API keys", () => {
    expect(() =>
      validateChatGptSubscriptionAuth({
        auth_mode: "apikey",
        OPENAI_API_KEY: "sk-test"
      })
    ).toThrow("auth_mode=chatgpt");

    expect(() =>
      validateChatGptSubscriptionAuth({
        auth_mode: "chatgpt",
        OPENAI_API_KEY: "sk-test",
        tokens: { access_token: "subscription-token" }
      })
    ).toThrow("refuses API-billed authentication");
  });

  it("rejects missing ChatGPT tokens", () => {
    expect(() =>
      validateChatGptSubscriptionAuth({ auth_mode: "chatgpt", tokens: {} })
    ).toThrow("does not contain ChatGPT login tokens");
  });
});

describe("createSubscriptionEnvironment", () => {
  it("removes API billing and endpoint variables case-insensitively", () => {
    const environment = createSubscriptionEnvironment({
      PATH: "C:\\tools",
      OPENAI_API_KEY: "secret",
      CODEX_API_KEY: "secret",
      AZURE_OPENAI_API_KEY: "secret",
      openai_base_url: "https://api.example.test"
    });

    expect(environment).toEqual({ PATH: "C:\\tools" });
  });
});