// @ts-nocheck
export function listUsers(req, res) {
  return res.json({
    data: [
      {
        id: 1,
        name: "Jane Doe",
      },
    ],
  });
}
