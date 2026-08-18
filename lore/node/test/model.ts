export interface ModelTurn {
  tool: string;
  input: Record<string, unknown>;
}

export function scriptModel(turns: ModelTurn[] | { status: number }) {
  const requests: Record<string, unknown>[] = [];
  let call = 0;
  const otherwise = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.hostname !== "api.anthropic.com") {
      throw new Error(`unexpected outbound fetch during test: ${request.method} ${url}`);
    }
    requests.push(await request.json());
    if (!Array.isArray(turns)) {
      return Response.json({ error: "model down" }, { status: turns.status });
    }
    const turn = turns[Math.min(call++, turns.length - 1)];
    const events: [string, unknown][] = [
      [
        "message_start",
        {
          type: "message_start",
          message: {
            id: `msg_${call}`,
            type: "message",
            role: "assistant",
            model: "claude-sonnet-5",
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: {
              input_tokens: 1000,
              output_tokens: 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0
            }
          }
        }
      ],
      [
        "content_block_start",
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: `toolu_${call}`, name: turn.tool, input: {} }
        }
      ],
      [
        "content_block_delta",
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: JSON.stringify(turn.input) }
        }
      ],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      [
        "message_delta",
        {
          type: "message_delta",
          delta: { stop_reason: "tool_use", stop_sequence: null },
          usage: { output_tokens: 200 }
        }
      ],
      ["message_stop", { type: "message_stop" }]
    ];
    return new Response(
      events
        .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data) ?? "null"}\n\n`)
        .join(""),
      { headers: { "content-type": "text/event-stream" } }
    );
  };
  return { requests, otherwise };
}
