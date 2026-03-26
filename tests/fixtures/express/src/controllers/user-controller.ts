// @ts-nocheck
export async function createUser(req, res) {
  const { name, email, age } = req.body;
  const page = req.query.page;
  const traceId = req.get("X-Trace-Id");

  return res.status(201).json({
    message: "user created",
    data: {
      id: 1,
      name,
      email,
      age,
      page,
      traceId,
    },
  });
}

export function showUser(req, res) {
  const { id } = req.params;

  return res.json({
    data: {
      id,
      name: "Jane Doe",
    },
  });
}
