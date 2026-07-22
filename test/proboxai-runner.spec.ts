import { ProboxAiRunner } from "../src/sessions/proboxai-runner.service";

describe("ProboxAiRunner hash chain", () => {
  it("binds each frame to its predecessor", () => {
    const first = ProboxAiRunner.hash('{"type":"thread.started"}');
    const second = ProboxAiRunner.hash('{"type":"turn.started"}', first);

    expect(first).toHaveLength(64);
    expect(second).toHaveLength(64);
    expect(second).not.toEqual(ProboxAiRunner.hash('{"type":"turn.started"}'));
  });
});
