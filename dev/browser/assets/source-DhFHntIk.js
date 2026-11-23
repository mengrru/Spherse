const n="data-spherse-sdk",a="__spherse-sdk.js";function r(e,t,s){return e.includes(s)?e:/<head[^>]*>/i.test(e)?e.replace(/<head([^>]*)>/i,`<head$1>${t}`):/<html[^>]*>/i.test(e)?e.replace(/<html([^>]*)>/i,`<html$1><head>${t}</head>`):`${t}${e}`}const i=`"use strict";
(() => {
  // src/meta.ts
  var SDK_VERSION = "1";

  // src/runtime/messaging.ts
  var pending = {};
  var DEFAULT_TIMEOUT = 1e4;
  function genId() {
    return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function postAction(action, params, requestId) {
    const msg = {
      type: "spherse:action",
      action,
      params: params != null ? params : {},
      sdk: SDK_VERSION
    };
    if (requestId) msg.requestId = requestId;
    window.parent.postMessage(msg, "*");
  }
  function call(action, params, timeoutMs = DEFAULT_TIMEOUT) {
    return new Promise((resolve, reject) => {
      const id = genId();
      const timer = setTimeout(() => {
        if (!pending[id]) return;
        delete pending[id];
        reject(new Error("spherse:timeout"));
      }, timeoutMs);
      pending[id] = (ok, data2) => {
        var _a;
        clearTimeout(timer);
        delete pending[id];
        if (ok) resolve(data2);
        else reject(new Error((_a = data2 == null ? void 0 : data2.error) != null ? _a : "spherse:error"));
      };
      postAction(action, params, id);
    });
  }
  function fire(action, params) {
    postAction(action, params, null);
  }
  function installResponseListener() {
    window.addEventListener("message", (event) => {
      const data2 = event.data;
      if (!data2 || data2.type !== "spherse:response") return;
      const resolver = pending[data2.requestId];
      if (resolver) resolver(data2.ok, data2.data);
    });
  }

  // src/runtime/context.ts
  var runtime = null;
  var waiters = [];
  function applyRuntime(message) {
    if (!message.sessionId) return;
    runtime = {
      sessionId: message.sessionId,
      agentId: message.agentId,
      projectId: message.projectId
    };
    try {
      window.__SPHERSE__ = runtime;
    } catch {
    }
    const pending2 = waiters;
    waiters = [];
    for (const resolve of pending2) resolve(runtime);
  }
  function seedFromInjectedGlobal() {
    try {
      const injected = window.__SPHERSE__;
      if (injected && injected.sessionId) runtime = injected;
    } catch {
    }
  }
  function installRuntimeListener() {
    window.addEventListener("message", (event) => {
      const data2 = event.data;
      if (data2 && data2.type === "spherse:runtime") applyRuntime(data2);
    });
  }
  function getRuntime() {
    return new Promise((resolve) => {
      if (runtime) resolve(runtime);
      else waiters.push(resolve);
    });
  }
  function peekRuntime() {
    return runtime;
  }

  // src/runtime/actions.ts
  var UPLOAD_TIMEOUT_MS = 6e4;
  var asPath = (value) => typeof value === "string" ? { path: value } : value;
  var asUrl = (value) => typeof value === "string" ? { url: value } : value;
  var asSession = (value) => typeof value === "string" ? { sessionId: value } : value;
  var actions = {
    createSession: (params) => call("createSession", params),
    sendMessage: (params) => call("sendMessage", params),
    uploadFile: (params) => call("uploadFile", params, UPLOAD_TIMEOUT_MS),
    openFile: (value) => fire("openFile", asPath(value)),
    openExternalLink: (value) => fire("openExternalLink", asUrl(value)),
    openSession: (value) => fire("openSession", asSession(value)),
    floatSession: (value) => fire("floatSession", asSession(value)),
    unfloatSession: () => fire("unfloatSession", {}),
    floatContent: (value) => fire("floatContent", asPath(value)),
    unfloatContent: (value) => fire("unfloatContent", asPath(value)),
    emitAgentTriggerEvent: (params) => fire("emitAgentTriggerEvent", params),
    toast: (params) => fire("showToast", params)
  };

  // src/runtime/data.ts
  var data = {
    get: (params) => call("data.get", params),
    set: (params) => call("data.set", params),
    delete: (params) => call("data.delete", params),
    keys: (params) => call("data.keys", params),
    entries: (params) => call("data.entries", params),
    mutate: (params) => call("data.mutate", params)
  };

  // src/runtime/api.ts
  function apiCall(op, args = {}) {
    return call("api.call", { op, args });
  }
  var api = {
    call: apiCall,
    agents: {
      list: () => apiCall("agents.list"),
      get: (id) => apiCall("agents.get", { id })
    },
    sessions: {
      list: (agentId) => apiCall("sessions.list", { agentId }),
      messages: (agentId, id) => apiCall("sessions.messages", { agentId, id }),
      status: (agentId, id) => apiCall("sessions.status", { agentId, id })
    },
    content: {
      get: (filePath) => apiCall("content.get", { path: filePath }),
      listDir: (dirPath) => apiCall("content.listDir", { path: dirPath }),
      stat: (filePath) => apiCall("content.stat", { path: filePath })
    },
    fileTree: () => apiCall("fileTree")
  };

  // src/runtime/events.ts
  var subscriptions = /* @__PURE__ */ new Map();
  function resolveEventPath(input, baseUri) {
    if (!input.startsWith("./") && !input.startsWith("../")) return input;
    let resolved;
    try {
      resolved = new URL(input, baseUri);
    } catch {
      return null;
    }
    const segments = resolved.pathname.split("/").filter(Boolean);
    const previewIndex = segments.lastIndexOf("preview");
    if (previewIndex < 0) return null;
    let projectSegments = segments.slice(previewIndex + 1);
    if (projectSegments[0] === "__auth") {
      if (projectSegments.length < 3) return null;
      projectSegments = projectSegments.slice(2);
    }
    if (projectSegments.length === 0) return null;
    try {
      const decoded = projectSegments.map((segment) => decodeURIComponent(segment));
      if (decoded.some((segment) => segment.includes("/") || segment.includes("\\\\"))) return null;
      return decoded.join("/");
    } catch {
      return null;
    }
  }
  function genId2() {
    return "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function postControl(type, subscriptionId, subscription) {
    window.parent.postMessage(
      {
        type,
        subscriptionId,
        event: subscription == null ? void 0 : subscription.event,
        filter: (subscription == null ? void 0 : subscription.event) === "file:update" ? subscription.filter : void 0,
        sdk: SDK_VERSION
      },
      "*"
    );
  }
  function registerSubscription(subscription) {
    const subscriptionId = genId2();
    subscriptions.set(subscriptionId, subscription);
    postControl("spherse:event-subscribe", subscriptionId, subscription);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      subscriptions.delete(subscriptionId);
      postControl("spherse:event-unsubscribe", subscriptionId);
    };
  }
  function on(event, filterOrHandler, maybeHandler) {
    if (event === "file:update") {
      const filter = filterOrHandler;
      if (!filter || typeof filter.path !== "string" || !filter.path.trim()) {
        throw new Error("spherse:invalid_event_filter");
      }
      if (typeof maybeHandler !== "function") throw new Error("spherse:invalid_event_handler");
      const path = resolveEventPath(filter.path, document.baseURI);
      if (!path) throw new Error("spherse:invalid_event_filter");
      return registerSubscription({
        event,
        filter: { path },
        handler: maybeHandler
      });
    }
    if (event === "navigate") {
      if (typeof filterOrHandler !== "function") throw new Error("spherse:invalid_event_handler");
      return registerSubscription({
        event,
        handler: filterOrHandler
      });
    }
    throw new Error("spherse:unsupported_event");
  }
  function installEventListener() {
    window.addEventListener("message", (event) => {
      const data2 = event.data;
      if (!data2 || data2.type !== "spherse:event" || data2.event !== "file:update" && data2.event !== "navigate") {
        return;
      }
      const subscription = subscriptions.get(data2.subscriptionId);
      if (!subscription) return;
      if (subscription.event !== data2.event) return;
      const handler = subscription.handler;
      try {
        void Promise.resolve(handler(data2.payload)).catch(() => void 0);
      } catch {
        return;
      }
    });
    window.addEventListener("pagehide", () => {
      for (const [subscriptionId] of subscriptions) {
        postControl("spherse:event-unsubscribe", subscriptionId);
      }
      subscriptions.clear();
    });
  }
  var events = { on };

  // src/runtime/index.ts
  if (!window.__SPHERSE_SDK__) {
    window.__SPHERSE_SDK__ = true;
    installResponseListener();
    installRuntimeListener();
    installEventListener();
    seedFromInjectedGlobal();
    const spherse = {
      version: SDK_VERSION,
      call,
      fire,
      getRuntime,
      get runtime() {
        return peekRuntime();
      },
      ...actions,
      data,
      api,
      events
    };
    window.spherse = spherse;
    if (!window.Spherse) window.Spherse = spherse;
  }
})();
`;export{n as S,i as a,a as b,r as i};
