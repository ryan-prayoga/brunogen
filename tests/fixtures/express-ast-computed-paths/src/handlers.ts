// @ts-nocheck
export function listUsers(_req, res) {
  return res.json({
    data: [],
  });
}

export function runUserAction(req, res) {
  return res.status(202).json({
    id: req.params.id,
    accepted: true,
  });
}
