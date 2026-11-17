// GET /api/status: tells the pages whether a real model is connected.
import { MODEL, hasKey } from './_lib/claude.js';

export default function handler(req, res) {
  // v goes up whenever the server code changes in a way the pages rely on (see NEED_V in js/bb-api.js)
  res.status(200).json({ live: hasKey(), model: hasKey() ? MODEL : null, v: 24 });
}
