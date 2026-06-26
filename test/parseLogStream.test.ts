import { describe, expect, it } from "vitest";
import { parseLogStream } from "../src/utils/parseLogStream.js";

describe("parseLogStream", () => {
  it("unwraps Argo CD gRPC-gateway result envelope", () => {
    const raw = [
      JSON.stringify({
        result: {
          content: "hello world",
          podName: "my-pod-abc",
          timeStampStr: "2026-06-26T18:15:49.443668295Z",
          last: false,
        },
      }),
      JSON.stringify({
        result: {
          content: "second line",
          podName: "my-pod-abc",
          timeStampStr: "2026-06-26T18:15:50.443668295Z",
          last: true,
        },
      }),
    ].join("\n");

    expect(parseLogStream(raw)).toEqual([
      {
        content: "hello world",
        podName: "my-pod-abc",
        timeStamp: "2026-06-26T18:15:49.443668295Z",
      },
      {
        content: "second line",
        podName: "my-pod-abc",
        timeStamp: "2026-06-26T18:15:50.443668295Z",
      },
    ]);
  });

  it("accepts flat log entries without result wrapper", () => {
    const raw = JSON.stringify({
      content: "flat log",
      podName: "pod-1",
      timeStampStr: "2026-01-01T00:00:00Z",
    });

    expect(parseLogStream(raw)).toEqual([
      {
        content: "flat log",
        podName: "pod-1",
        timeStamp: "2026-01-01T00:00:00Z",
      },
    ]);
  });

  it("falls back to raw text for non-json lines", () => {
    expect(parseLogStream("plain text log")).toEqual([
      { content: "plain text log" },
    ]);
  });
});
