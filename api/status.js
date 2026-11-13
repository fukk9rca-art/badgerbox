// GET /api/status: tells the pages whether a real model is connected.
import { MODEL, hasKey } from './_lib/claude.js';

export default function handler(req, res) {
  res.status(200).json({ live: hasKey(), model: hasKey() ? MODEL : null });
}
