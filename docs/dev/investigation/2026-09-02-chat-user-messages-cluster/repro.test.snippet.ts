  it("loses the in-flight reply when the run completes between fetch dispatch and response", async () => {
    let lateResolve: ((value: unknown) => void) | undefined;
    const client: ApiClient = {
      getSessionMessagesPage: vi.fn()
        .mockResolvedValueOnce({ entries: [], hasMore: false, oldestId: null })
        .mockImplementationOnce(() => new Promise((resolve) => {
          lateResolve = resolve;
        })),
    } as unknown as ApiClient;
    useStreamingStore.getState().attach(client, "bg1", BASE_URL, "p1", "a1");
    const socket = mock.instances[mock.instances.length - 1];
    socket.readyState = OPEN;
    socket.onopen?.({} as Event);
    await vi.advanceTimersByTimeAsync(0);

    useStreamingStore.getState().sendMessage("bg1", "hello");
    socket.onmessage?.({ data: JSON.stringify({ type: "message_start", message: { role: "assistant" } }) } as MessageEvent);
    socket.onmessage?.({ data: JSON.stringify({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "partial answer" }] } }) } as MessageEvent);
    await vi.advanceTimersByTimeAsync(0);
    expect(useStreamingStore.getState().sessions.bg1.messages).toHaveLength(2);

    socket.close();
    await vi.advanceTimersByTimeAsync(1000);
    const reopened = mock.instances[mock.instances.length - 1];
    reopened.readyState = OPEN;
    reopened.onopen?.({} as Event);
    await vi.advanceTimersByTimeAsync(0);

    lateResolve?.({
      entries: [
        { id: 1, message: { role: "user", content: "hello", timestamp: 10 } },
      ],
      hasMore: false,
      oldestId: 1,
    });
    await vi.advanceTimersByTimeAsync(0);

    const messages = useStreamingStore.getState().sessions.bg1.messages;
    expect(messages.map((m) => m.content)).toEqual(["hello", "partial answer"]);
  });
