import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assessCommand, redactText } from "./command-policy.js";

describe("command policy", () => {
  it("blocks a small set of irreversible host destruction patterns", () => {
    assert.equal(assessCommand("rm -rf / --no-preserve-root").blocked, true);
    assert.equal(assessCommand("sh -c 'r''m -rf /'").blocked, true);
    assert.equal(assessCommand("find / -xdev -delete").blocked, true);
    assert.equal(assessCommand(":(){ :|:& };:").blocked, true);
    assert.equal(assessCommand("dd if=/dev/zero of=/dev/sda bs=1M").blocked, true);
    assert.equal(assessCommand("mkfs.ext4 /dev/sda1").blocked, true);
  });

  it("marks allowed operational changes without requiring confirmation", () => {
    const assessment = assessCommand("sudo systemctl restart nginx");
    assert.equal(assessment.blocked, false);
    assert.equal(assessment.risk, "critical");
    assert.match(assessment.signals.join(","), /privilege_escalation/);
  });

  it("redacts common secrets and bounds output", () => {
    const fakePem = ["-----BEGIN ", "PRIVATE ", "KEY-----secret-----END ", "PRIVATE ", "KEY-----"].join("");
    const result = redactText([
      "token=abc123",
      "password: hunter2",
      'JSON={"token":"json-secret","password":"quoted secret"}',
      "Authorization: Bearer bearer-secret",
      "Authorization: Basic dXNlcjpwYXNz",
      "DATABASE_URL=postgresql://admin:database-secret@db.example.test/app",
      "JWT=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signaturevalue",
      fakePem
    ].join("\n"));
    assert.match(result.value, /token=\[REDACTED\]/);
    assert.match(result.value, /password: \[REDACTED\]/);
    assert.match(result.value, /"token":"\[REDACTED\]"/);
    assert.doesNotMatch(result.value, /json-secret|quoted secret|bearer-secret|dXNlcjpwYXNz|database-secret|eyJhbGci/);
    assert.match(result.value, /DATABASE_URL=\[REDACTED\]/);
    assert.match(result.value, /\[REDACTED_PEM\]/);
    assert.equal(redactText("x".repeat(20), 8).truncated, true);
  });
});
