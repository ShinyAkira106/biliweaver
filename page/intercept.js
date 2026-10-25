// Biliweaver page engine, part 3: wraps fetch and XMLHttpRequest.
//
// Modules register routes. A route looks at a request and either returns a handler, which
// produces a standard Response, or null to leave the request alone. A handler that throws
// before it has a Response makes the request go out unchanged, so a Biliweaver problem
// degrades to ordinary playback instead of breaking it. Observers only read responses
// (for example the play address API) and never change them.
(function defineBiliweaverIntercept(root) {
  "use strict";
  const bw = root.__biliweaver;
  if (!bw || bw.intercept) return;
  const { native, util, stats } = bw;

  const routes = [];
  const observers = [];
  const PASS = Object.freeze({ pass: true });

  function match(request) {
    for (const route of routes) {
      try {
        const handler = route(request);
        if (handler) return handler;
      } catch (error) {
        bw.log("route error", error);
      }
    }
    return null;
  }

  function notify(url, readText) {
    for (const observer of observers) {
      if (!observer.test(url)) continue;
      readText().then((text) => {
        try { observer.callback(text, url); } catch (error) { bw.log("observer error", error); }
      }, () => {});
    }
  }

  function makeResponse(body, { status = 200, statusText = "", headers = {}, url = "" } = {}) {
    const response = new native.Response(body, { status, statusText: statusText || (status === 206 ? "Partial Content" : "OK"), headers });
    if (url) {
      try { Object.defineProperty(response, "url", { value: url }); } catch (_error) {}
    }
    return response;
  }

  // ---------------------------------------------------------------------------------
  // fetch
  // ---------------------------------------------------------------------------------
  function describeFetch(input, init) {
    const isRequest = typeof Request !== "undefined" && input instanceof Request;
    const headers = new native.Headers(isRequest ? input.headers : undefined);
    if (init?.headers) new native.Headers(init.headers).forEach((value, name) => headers.set(name, value));
    return {
      kind: "fetch",
      url: util.absoluteUrl(isRequest ? input.url : input),
      method: String(init?.method || (isRequest ? input.method : "GET")).toUpperCase(),
      headers,
      signal: init?.signal || (isRequest ? input.signal : null),
      credentials: init?.credentials || (isRequest ? input.credentials : "same-origin")
    };
  }

  function patchedFetch(input, init) {
    let request = null;
    try { request = describeFetch(input, init); } catch (_error) { return native.fetch(input, init); }
    const handler = match(request);
    if (!handler) {
      const pending = native.fetch(input, init);
      if (observers.some((observer) => observer.test(request.url))) {
        pending.then((response) => notify(request.url, () => response.clone().text()), () => {});
      }
      return pending;
    }
    return Promise.resolve().then(() => handler(request)).catch((error) => {
      if (error?.name === "AbortError") throw error;
      if (error !== PASS) {
        stats.counters.fallbacks += 1;
        bw.log("fetch fallback", request.url, error);
      }
      return native.fetch(input, init);
    });
  }
  try {
    Object.defineProperty(patchedFetch, "name", { value: "fetch" });
    patchedFetch.toString = () => "function fetch() { [native code] }";
  } catch (_error) {}
  root.fetch = patchedFetch;

  // ---------------------------------------------------------------------------------
  // XMLHttpRequest. The object the page created stays the same; while Biliweaver answers
  // a request, a few of its properties are shadowed on that one instance.
  // ---------------------------------------------------------------------------------
  const proto = native.XHR.prototype;
  const states = new WeakMap();
  const SHADOWED = ["readyState", "status", "statusText", "responseURL", "response", "responseText", "responseXML", "getResponseHeader", "getAllResponseHeaders"];

  function unshadow(xhr) {
    for (const name of SHADOWED) {
      if (Object.prototype.hasOwnProperty.call(xhr, name)) delete xhr[name];
    }
  }

  proto.open = function open(method, url, ...rest) {
    const previous = states.get(this);
    if (previous?.virtual) {
      previous.controller?.abort();
      unshadow(this);
    }
    states.set(this, {
      method: String(method || "GET").toUpperCase(),
      url: util.absoluteUrl(url),
      headers: new native.Headers(),
      async: rest.length === 0 || rest[0] !== false,
      virtual: false
    });
    return native.open.call(this, method, url, ...rest);
  };

  proto.setRequestHeader = function setRequestHeader(name, value) {
    const state = states.get(this);
    if (state) {
      try { state.headers.append(name, value); } catch (_error) {}
    }
    return native.setRequestHeader.call(this, name, value);
  };

  proto.send = function send(body) {
    const state = states.get(this);
    if (state?.async) {
      const request = {
        kind: "xhr",
        url: state.url,
        method: state.method,
        headers: state.headers,
        signal: null,
        credentials: this.withCredentials ? "include" : "same-origin"
      };
      const handler = match(request);
      if (handler) {
        runVirtual(this, state, handler, request, body);
        return undefined;
      }
      if (observers.some((observer) => observer.test(state.url))) {
        this.addEventListener("load", () => {
          notify(state.url, async () => {
            if (this.responseType === "" || this.responseType === "text") return this.responseText;
            if (this.responseType === "json") return JSON.stringify(this.response);
            throw new Error("unreadable");
          });
        }, { once: true });
      }
    }
    return native.send.call(this, body);
  };

  proto.abort = function abort() {
    const state = states.get(this);
    if (state?.virtual && state.abortVirtual) return state.abortVirtual("abort");
    return native.abort.call(this);
  };

  function fire(xhr, type, init) {
    const event = type === "readystatechange" ? new Event(type) : new ProgressEvent(type, init || {});
    try { xhr.dispatchEvent(event); } catch (error) { setTimeout(() => { throw error; }); }
  }

  function runVirtual(xhr, state, handler, request, body) {
    const controller = new AbortController();
    request.signal = controller.signal;
    state.virtual = true;
    state.controller = controller;
    let readyState = 1;
    let finished = false;
    let timeoutTimer = null;
    const view = { status: 0, statusText: "", url: "", headers: null, response: null, text: "" };

    const define = () => {
      const props = {
        readyState: { get: () => readyState, configurable: true },
        status: { get: () => view.status, configurable: true },
        statusText: { get: () => view.statusText, configurable: true },
        responseURL: { get: () => view.url, configurable: true },
        response: { get: () => view.response, configurable: true },
        responseText: {
          get: () => {
            if (xhr.responseType !== "" && xhr.responseType !== "text") throw new DOMException("responseText is only available if responseType is '' or 'text'.", "InvalidStateError");
            return readyState === 4 ? view.text : "";
          },
          configurable: true
        },
        responseXML: { get: () => null, configurable: true },
        getResponseHeader: { value: (name) => (view.headers && readyState >= 2 ? view.headers.get(name) : null), configurable: true },
        getAllResponseHeaders: {
          value: () => {
            if (!view.headers || readyState < 2) return "";
            let out = "";
            view.headers.forEach((value, name) => { out += `${name}: ${value}\r\n`; });
            return out;
          },
          configurable: true
        }
      };
      Object.defineProperties(xhr, props);
    };

    const end = (type) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutTimer);
      readyState = 4;
      view.status = 0;
      view.response = xhr.responseType === "" || xhr.responseType === "text" ? "" : null;
      fire(xhr, "readystatechange");
      fire(xhr, type, { loaded: 0, total: 0, lengthComputable: false });
      fire(xhr, "loadend", { loaded: 0, total: 0, lengthComputable: false });
      if (type === "abort") readyState = 0;
    };
    state.abortVirtual = (type) => {
      controller.abort();
      end(type);
    };

    define();
    fire(xhr, "loadstart", { loaded: 0, total: 0, lengthComputable: false });
    if (xhr.timeout > 0) timeoutTimer = setTimeout(() => state.abortVirtual("timeout"), xhr.timeout);

    Promise.resolve().then(() => handler(request)).then(async (response) => {
      if (finished) return;
      view.status = response.status;
      view.statusText = response.statusText;
      view.url = response.url || request.url;
      view.headers = response.headers;
      readyState = 2;
      fire(xhr, "readystatechange");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (finished) return;
      readyState = 3;
      fire(xhr, "readystatechange");
      const total = bytes.byteLength;
      fire(xhr, "progress", { loaded: total, total, lengthComputable: true });
      const type = xhr.responseType;
      if (type === "arraybuffer") view.response = bytes.buffer.byteLength === total ? bytes.buffer : bytes.slice().buffer;
      else if (type === "blob") view.response = new Blob([bytes], { type: response.headers.get("content-type") || "" });
      else {
        view.text = new TextDecoder().decode(bytes);
        if (type === "json") {
          try { view.response = JSON.parse(view.text); } catch (_error) { view.response = null; }
        } else view.response = view.text;
      }
      finished = true;
      clearTimeout(timeoutTimer);
      readyState = 4;
      fire(xhr, "readystatechange");
      fire(xhr, "load", { loaded: total, total, lengthComputable: true });
      fire(xhr, "loadend", { loaded: total, total, lengthComputable: true });
    }).catch((error) => {
      if (finished) return;
      if (error?.name === "AbortError") return;
      if (readyState === 1) {
        // Nothing reached the page yet: send the request the ordinary way instead.
        if (error !== PASS) {
          stats.counters.fallbacks += 1;
          bw.log("xhr fallback", request.url, error);
        }
        clearTimeout(timeoutTimer);
        finished = true;
        state.virtual = false;
        unshadow(xhr);
        try { native.send.call(xhr, body); } catch (sendError) { console.warn("[Biliweaver]", sendError); }
        return;
      }
      end("error");
    });
  }

  bw.intercept = Object.freeze({
    PASS,
    addRoute(route) { routes.push(route); },
    observe(test, callback) { observers.push({ test, callback }); },
    makeResponse
  });
})(globalThis);
