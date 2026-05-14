// @ts-nocheck
export function listReports(req, res) {
  return res.json({
    data: [
      {
        id: 1,
        name: "Daily report",
      },
    ],
  });
}
