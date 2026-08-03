/** Wire-protocol version embedded in every `spherse:action` message (`msg.sdk`). */
export const SDK_VERSION = "1";

/** Idempotency marker written onto every injected SDK `<script>` element. */
export const SDK_MARK = "data-spherse-sdk";

/** Reserved preview filename that serves the browser bundle (`__spherse-sdk.js`). */
export const SDK_FILENAME = "__spherse-sdk.js";
