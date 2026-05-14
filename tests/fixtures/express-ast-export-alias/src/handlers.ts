// @ts-nocheck
export function listUsers(req, res) {
  return res.status(200).json({
    data: [
      {
        id: 1,
        name: "Jane Doe",
      },
    ],
  });
}
