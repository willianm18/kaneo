import { describe, expect, it } from "vitest";
import {
  signConversationState,
  verifyConversationState,
} from "../../../apps/api/src/assistant/conversation-signature";

const SECRET = "test-secret-at-least-32-characters-long";

const STATE = [
  { role: "system", content: "sys" },
  { role: "user", content: "apague a tarefa X" },
  {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: "c9",
        type: "function",
        function: { name: "delete_task", arguments: "{}" },
      },
    ],
  },
];

describe("signConversationState / verifyConversationState", () => {
  it("verifies a signature produced for the same state", () => {
    const signature = signConversationState(STATE, SECRET);
    expect(verifyConversationState(STATE, signature, SECRET)).toBe(true);
  });

  it("rejects a tampered state signed under the same secret", () => {
    const signature = signConversationState(STATE, SECRET);

    const tampered = JSON.parse(JSON.stringify(STATE));
    tampered[2].tool_calls[0].id = "forged-id";

    expect(verifyConversationState(tampered, signature, SECRET)).toBe(false);
  });

  it("rejects when the confirmations/tool arguments embedded in the state change", () => {
    const signature = signConversationState(STATE, SECRET);

    const tampered = JSON.parse(JSON.stringify(STATE));
    tampered[2].tool_calls[0].function.arguments =
      '{"taskId":"someone-elses-task"}';

    expect(verifyConversationState(tampered, signature, SECRET)).toBe(false);
  });

  it("rejects a missing signature", () => {
    expect(verifyConversationState(STATE, undefined, SECRET)).toBe(false);
  });

  it("rejects an empty-string signature", () => {
    expect(verifyConversationState(STATE, "", SECRET)).toBe(false);
  });

  it("rejects malformed (non-hex) signatures without throwing", () => {
    expect(() =>
      verifyConversationState(STATE, "not-valid-hex!!", SECRET),
    ).not.toThrow();
    expect(verifyConversationState(STATE, "not-valid-hex!!", SECRET)).toBe(
      false,
    );
  });

  it("rejects a signature produced under a different secret", () => {
    const signature = signConversationState(STATE, "a-different-secret");
    expect(verifyConversationState(STATE, signature, SECRET)).toBe(false);
  });

  it("is independent of object key order (canonical JSON)", () => {
    const reordered = [
      { content: "sys", role: "system" },
      { content: "apague a tarefa X", role: "user" },
      {
        content: null,
        tool_calls: [
          {
            function: { arguments: "{}", name: "delete_task" },
            id: "c9",
            type: "function",
          },
        ],
        role: "assistant",
      },
    ];

    const signature = signConversationState(STATE, SECRET);
    expect(verifyConversationState(reordered, signature, SECRET)).toBe(true);
  });
});
