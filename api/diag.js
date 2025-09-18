export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(200).json({
    runtime: "node",
    hasKey: !!process.env.OPENAI_API_KEY,
    // debug léger : NE PAS laisser en prod
    keys: Object.keys(process.env).filter(k => k.startsWith("OPEN")),
  });
}
