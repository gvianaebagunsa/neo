// Runs the language model off the main thread so the sphere and the page stay
// smooth while it thinks. WebLLM keeps the downloaded model in this origin's
// Cache Storage, so after the first download everything works offline.
import { WebWorkerMLCEngineHandler } from "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/lib/index.js";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
